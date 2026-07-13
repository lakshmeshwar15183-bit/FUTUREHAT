// Lumixo — account, archived chats, social links, deletion & security events.
// Framework-agnostic (web + mobile). Backs the 0010_account_privacy migration.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from './types.js';
import { getCurrentUser } from './api.js';
import { friendlyAuthError, isValidEmail, validatePassword } from './authErrors.js';
import { setMyPhone, logout, getMyAccount } from './authApi.js';
import type { DefaultCountry } from './phone.js';

export { getMyAccount, setMyPhone };

// ── Archived conversations ────────────────────────────────────────────────────
export async function getArchivedIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('archived_conversations').select('conversation_id');
  return (data ?? []).map((r: any) => r.conversation_id);
}
export async function archiveConversation(client: SupabaseClient, conversationId: UUID) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('archived_conversations')
    .upsert({ user_id: user.id, conversation_id: conversationId });
  return { error };
}
export async function unarchiveConversation(client: SupabaseClient, conversationId: UUID) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('archived_conversations')
    .delete()
    .eq('user_id', user.id)
    .eq('conversation_id', conversationId);
  return { error };
}

// ── Social links on the profile ───────────────────────────────────────────────
export interface SocialLink { label: string; url: string }
export async function updateSocialLinks(client: SupabaseClient, links: SocialLink[]) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const clean = links
    .filter((l) => l.url.trim())
    .slice(0, 10)
    .map((l) => ({ label: l.label.trim().slice(0, 40), url: l.url.trim().slice(0, 300) }));
  const { error } = await client.from('profiles').update({ links: clean }).eq('id', user.id);
  return { error };
}

// ── Email change (Supabase Auth) ──────────────────────────────────────────────

export async function changeEmail(client: SupabaseClient, newEmail: string) {
  const mail = newEmail.trim().toLowerCase();
  if (!isValidEmail(mail)) {
    return { error: new Error('Enter a valid email address.') };
  }
  const { error } = await client.auth.updateUser({ email: mail });
  if (error) return { error: new Error(friendlyAuthError(error, 'Could not update email.')) };
  const user = await getCurrentUser(client);
  if (user) {
    void client
      .from('security_events')
      .insert({ user_id: user.id, kind: 'email_change' })
      .then(() => {}, () => {});
  }
  return { error: null };
}
export async function changePassword(client: SupabaseClient, newPassword: string) {
  const check = validatePassword(newPassword);
  if (!check.ok) return { error: new Error(check.message) };
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) return { error: new Error(friendlyAuthError(error, 'Could not update password.')) };
  const user = await getCurrentUser(client);
  if (user) {
    void client
      .from('security_events')
      .insert({ user_id: user.id, kind: 'password_change' })
      .then(() => {}, () => {});
  }
  // Password change → revoke other sessions
  void client.rpc('logout_all_devices').then(() => {}, () => {});
  return { error: null };
}

/** Update optional phone (E.164). Null clears it. */
export async function updateMyPhone(
  client: SupabaseClient,
  phone: string | null,
  defaultCountry: DefaultCountry = 'IN',
) {
  return setMyPhone(client, phone, defaultCountry);
}

/** Sign out of every device (global token revoke + force_logout stamp). */
export async function logoutAllDevices(client: SupabaseClient) {
  return logout(client, { allDevices: true });
}

// ── Account deletion (with recovery window) ──────────────────────────────────
export interface DeletionRequest {
  user_id: UUID; requested_at: string; purge_after: string;
  reason: string | null; status: 'pending' | 'cancelled' | 'completed';
}
export async function requestAccountDeletion(client: SupabaseClient, reason?: string) {
  const user = await getCurrentUser(client);
  if (!user) return { request: null, error: new Error('not authenticated') };
  // Prefer SECURITY DEFINER RPC (resets 30-day purge window). Fallback to table
  // upsert if migration 0044 is not applied yet.
  const { data: rpcData, error: rpcErr } = await client.rpc('request_account_deletion', {
    p_reason: reason ?? null,
  });
  if (!rpcErr && rpcData) {
    return { request: rpcData as DeletionRequest, error: null };
  }
  const { data, error } = await client
    .from('account_deletion_requests')
    .upsert({
      user_id: user.id,
      reason: reason ?? null,
      status: 'pending',
      requested_at: new Date().toISOString(),
      purge_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  return { request: data as DeletionRequest | null, error: error ?? rpcErr };
}
export async function cancelAccountDeletion(client: SupabaseClient) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error: rpcErr } = await client.rpc('cancel_account_deletion');
  if (!rpcErr) return { error: null };
  const { error } = await client
    .from('account_deletion_requests')
    .update({ status: 'cancelled' })
    .eq('user_id', user.id);
  return { error: error ?? rpcErr };
}
export async function getDeletionRequest(client: SupabaseClient): Promise<DeletionRequest | null> {
  const { data } = await client
    .from('account_deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .maybeSingle();
  return (data as DeletionRequest) ?? null;
}

// ── Security / login events ───────────────────────────────────────────────────
export interface SecurityEvent {
  id: UUID; user_id: UUID;
  kind: 'login' | 'logout' | 'password_change' | 'new_device' | 'twofa_enabled' | 'twofa_disabled' | 'email_change';
  ip: string | null; user_agent: string | null; created_at: string;
}
export async function logSecurityEvent(client: SupabaseClient, kind: SecurityEvent['kind'], userAgent?: string) {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('security_events')
    .insert({ user_id: user.id, kind, user_agent: userAgent ?? null });
  return { error };
}
export async function getSecurityEvents(client: SupabaseClient, limit = 50): Promise<SecurityEvent[]> {
  const { data } = await client
    .from('security_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as SecurityEvent[];
}
