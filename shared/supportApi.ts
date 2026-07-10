// Lumixo — trust & safety data layer: reports, support tickets, blocks, mutes.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, ReportReason } from './types.js';
import { getCurrentUser } from './api.js';

export type ReportTargetType = 'user' | 'message' | 'conversation' | 'channel' | 'community';
export type TicketKind = 'support' | 'bug' | 'feedback' | 'appeal' | 'grievance';

// Fixed reason list surfaced by the mobile "Report message" picker. Kept next to
// the report call so the UI and the server CHECK constraint can't drift apart.
export const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam',             label: 'Spam' },
  { value: 'harassment',       label: 'Harassment' },
  { value: 'abuse',            label: 'Abuse' },
  { value: 'fake_information', label: 'Fake Information' },
  { value: 'illegal_content',  label: 'Illegal Content' },
  { value: 'violence',         label: 'Violence' },
  { value: 'child_safety',     label: 'Child Safety' },
  { value: 'other',            label: 'Other' },
];

// Report a single message. Uses the report_message() SECURITY DEFINER RPC (0017)
// which snapshots the message content, derives the reported user + conversation,
// and verifies the reporter is a participant — so the admin dashboard gets a
// complete, tamper-proof record even if the message is later deleted.
export async function reportMessage(
  client: SupabaseClient,
  messageId: UUID,
  reason: ReportReason,
  details?: string,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('report_message', {
    p_message: messageId,
    p_reason: reason,
    p_details: details ?? null,
  });
  return { error: error ? new Error(error.message) : null };
}

export interface SupportTicket {
  id: UUID;
  user_id: UUID;
  kind: TicketKind;
  subject: string;
  body: string;
  attachment_url: string | null;
  device_info: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
}

export async function submitReport(
  client: SupabaseClient,
  targetType: ReportTargetType,
  targetId: UUID,
  reason: string,
  details?: string,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client.from('reports').insert({
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: details ?? null,
  });
  return { error };
}

export async function submitTicket(
  client: SupabaseClient,
  kind: TicketKind,
  subject: string,
  body: string,
  opts?: { attachmentUrl?: string; deviceInfo?: string },
): Promise<{ ticket: SupportTicket | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { ticket: null, error: new Error('not authenticated') };
  const { data, error } = await client
    .from('support_tickets')
    .insert({
      user_id: user.id,
      kind,
      subject,
      body,
      attachment_url: opts?.attachmentUrl ?? null,
      device_info: opts?.deviceInfo ?? null,
    })
    .select()
    .single();
  return { ticket: data, error };
}

export async function getMyTickets(client: SupabaseClient): Promise<SupportTicket[]> {
  const { data } = await client
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}

// ── Blocks ───────────────────────────────────────────────────────────────────
export async function blockUser(client: SupabaseClient, userId: UUID): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('blocked_users')
    .insert({ blocker_id: user.id, blocked_id: userId });
  return { error };
}

export async function unblockUser(client: SupabaseClient, userId: UUID): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('blocked_users')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', userId);
  return { error };
}

export async function getBlockedIds(client: SupabaseClient): Promise<UUID[]> {
  const user = await getCurrentUser(client);
  if (!user) return [];
  const { data } = await client.from('blocked_users').select('blocked_id').eq('blocker_id', user.id);
  return (data ?? []).map((r: any) => r.blocked_id);
}

// ── Mutes ────────────────────────────────────────────────────────────────────
export async function muteConversation(
  client: SupabaseClient,
  conversationId: UUID,
  mutedUntil?: string,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('muted_conversations')
    .upsert({ user_id: user.id, conversation_id: conversationId, muted_until: mutedUntil ?? null });
  return { error };
}

export async function unmuteConversation(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('muted_conversations')
    .delete()
    .eq('user_id', user.id)
    .eq('conversation_id', conversationId);
  return { error };
}

export async function getMutedIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('muted_conversations').select('conversation_id');
  return (data ?? []).map((r: any) => r.conversation_id);
}
