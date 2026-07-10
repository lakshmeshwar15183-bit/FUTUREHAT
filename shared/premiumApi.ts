// Lumixo+ — premium data-access layer (subscriptions, preferences, pins,
// scheduled messages). Framework-agnostic; web and mobile share it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Subscription,
  UserPreferences,
  ScheduledMessage,
  PlanId,
  UUID,
  MessageType,
} from './types.js';
import { PLANS } from './premium/plans.js';
import { computePeriodEnd } from './payments/provider.js';
import type { PaymentResult } from './payments/provider.js';

// ── Subscription ───────────────────────────────────────────────────────────────

export async function getSubscription(client: SupabaseClient): Promise<Subscription | null> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;
  const { data } = await client
    .from('subscriptions')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  return data;
}

export function isSubscriptionActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  return sub.status === 'active' && new Date(sub.current_period_end).getTime() > Date.now();
}

// Server-authoritative premium check. Honors the developer override even if the
// local subscription row is missing, so it's correct on every login. Falls back
// to false (callers also OR this with isSubscriptionActive) if the RPC is absent.
export async function getServerPremium(client: SupabaseClient): Promise<boolean> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await client.rpc('is_premium', { uid: auth.user.id });
  return !error && data === true;
}

// Admin/developer privilege check (derived from the protected developer allowlist).
export async function getServerAdmin(client: SupabaseClient): Promise<boolean> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await client.rpc('is_admin', { uid: auth.user.id });
  return !error && data === true;
}

// Activate (or renew) a subscription after a successful payment. Idempotent upsert.
export async function activateSubscription(
  client: SupabaseClient,
  plan: PlanId,
  result: PaymentResult,
): Promise<{ subscription: Subscription | null; error: Error | null }> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { subscription: null, error: new Error('not authenticated') };

  const nowIso = new Date().toISOString();
  const row = {
    user_id: auth.user.id,
    plan,
    status: 'active' as const,
    provider: result.provider,
    provider_subscription_id: result.providerSubscriptionId ?? null,
    provider_customer_id: result.providerCustomerId ?? null,
    amount_inr: PLANS[plan].priceInr,
    current_period_start: nowIso,
    current_period_end: computePeriodEnd(plan, nowIso),
    cancel_at_period_end: false,
    updated_at: nowIso,
  };

  const { data, error } = await client
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();
  return { subscription: data, error };
}

// Cancel = "don't renew." We flag cancel_at_period_end but KEEP status='active'
// so the user retains Lumixo+ until current_period_end (matching the UI promise
// "Cancels at period end"). is_premium()/isSubscriptionActive() both expire on the
// date, so access drops automatically when the period ends — no status flip needed.
export async function cancelSubscription(
  client: SupabaseClient,
): Promise<{ error: Error | null }> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('user_id', auth.user.id);
  return { error };
}

// user_ids of all currently-premium users (for badges).
export async function getPremiumUserIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('premium_users').select('user_id');
  return (data || []).map((r: any) => r.user_id);
}

// ── Preferences ────────────────────────────────────────────────────────────────

export const DEFAULT_PREFERENCES: Omit<UserPreferences, 'user_id' | 'updated_at'> = {
  theme: 'default',
  font: 'system',
  bubble_style: 'rounded',
  wallpaper: 'default',
  app_icon: 'classic',
  ghost_mode: false,
  app_lock: false,
  extra: {},
};

export async function getPreferences(client: SupabaseClient): Promise<UserPreferences | null> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;
  const { data } = await client
    .from('user_preferences')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (data) return data;
  return { user_id: auth.user.id, updated_at: new Date().toISOString(), ...DEFAULT_PREFERENCES };
}

export async function updatePreferences(
  client: SupabaseClient,
  updates: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>,
): Promise<{ preferences: UserPreferences | null; error: Error | null }> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { preferences: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('user_preferences')
    .upsert(
      { user_id: auth.user.id, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select()
    .single();
  return { preferences: data, error };
}

// ── Pinned conversations ───────────────────────────────────────────────────────

export async function getPinnedIds(client: SupabaseClient): Promise<UUID[]> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data } = await client
    .from('pinned_conversations')
    .select('conversation_id')
    .eq('user_id', auth.user.id);
  return (data || []).map((r: any) => r.conversation_id);
}

export async function pinConversation(client: SupabaseClient, conversationId: UUID) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('pinned_conversations')
    .upsert({ user_id: auth.user.id, conversation_id: conversationId });
  return { error };
}

export async function unpinConversation(client: SupabaseClient, conversationId: UUID) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('pinned_conversations')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('conversation_id', conversationId);
  return { error };
}

// NOTE: the premium "Hide private chats" feature (hidden_conversations table) was
// removed in 0027 and replaced by device-secured Chat Lock (see shared/chatLockApi.ts).
// Archive (accountApi) and Delete-for-me (deleted_conversations) are separate and untouched.

// ── Scheduled / reminder messages ──────────────────────────────────────────────

export async function scheduleMessage(
  client: SupabaseClient,
  conversationId: UUID,
  content: string,
  sendAt: Date,
  type: MessageType = 'text',
  mediaUrl?: string,
): Promise<{ scheduled: ScheduledMessage | null; error: Error | null }> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { scheduled: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('scheduled_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: auth.user.id,
      type,
      content,
      media_url: mediaUrl ?? null,
      send_at: sendAt.toISOString(),
    })
    .select()
    .single();
  return { scheduled: data, error };
}

export async function getScheduledMessages(
  client: SupabaseClient,
  conversationId?: UUID,
): Promise<ScheduledMessage[]> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  let q = client
    .from('scheduled_messages')
    .select('*')
    .eq('sender_id', auth.user.id)
    .eq('sent', false)
    .order('send_at', { ascending: true });
  if (conversationId) q = q.eq('conversation_id', conversationId);
  const { data } = await q;
  return data || [];
}

export async function cancelScheduledMessage(client: SupabaseClient, id: UUID) {
  const { error } = await client.from('scheduled_messages').delete().eq('id', id);
  return { error };
}

// Server-side dispatcher (also runnable from a pg_cron job). Safe to call from the
// client as a fallback so due messages flush while someone has the app open.
export async function dispatchDueMessages(client: SupabaseClient): Promise<number> {
  const { data } = await client.rpc('dispatch_due_messages');
  return typeof data === 'number' ? data : 0;
}
