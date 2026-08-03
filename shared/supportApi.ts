// Lumixo — trust & safety data layer: reports, support tickets, blocks, mutes.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, ReportReason } from './types.js';
import { getCurrentUser } from './api.js';

export type ReportTargetType = 'user' | 'message' | 'conversation' | 'channel' | 'community';
export type TicketKind = 'support' | 'bug' | 'feedback' | 'appeal' | 'grievance';
export type TicketStatus = 'open' | 'in_progress' | 'resolved';

// Fixed reason list surfaced by the mobile "Report message" picker.
export const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'abuse', label: 'Abuse' },
  { value: 'fake_information', label: 'Fake Information' },
  { value: 'illegal_content', label: 'Illegal Content' },
  { value: 'violence', label: 'Violence' },
  { value: 'child_safety', label: 'Child Safety' },
  { value: 'other', label: 'Other' },
];

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
  status: TicketStatus;
  created_at: string;
  /** Human-readable id e.g. LMX-A1B2C3D4 (migration 0056). */
  public_id?: string | null;
}

export interface SupportTicketReply {
  id: UUID;
  ticket_id: UUID;
  author_id: UUID | null;
  is_staff: boolean;
  body: string;
  created_at: string;
}

/** Display ticket id for UI / mailto. */
export function formatTicketId(t: Pick<SupportTicket, 'id' | 'public_id'>): string {
  if (t.public_id && t.public_id.trim()) return t.public_id.trim();
  return 'LMX-' + t.id.replace(/-/g, '').slice(0, 8).toUpperCase();
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

export async function getTicketReplies(
  client: SupabaseClient,
  ticketId: UUID,
): Promise<SupportTicketReply[]> {
  const { data } = await client
    .from('support_ticket_replies')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function replyToTicket(
  client: SupabaseClient,
  ticketId: UUID,
  body: string,
): Promise<{ reply: SupportTicketReply | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { reply: null, error: new Error('not authenticated') };
  const text = body.trim();
  if (!text) return { reply: null, error: new Error('Message is empty') };
  const { data, error } = await client
    .from('support_ticket_replies')
    .insert({
      ticket_id: ticketId,
      author_id: user.id,
      is_staff: false,
      body: text,
    })
    .select()
    .single();
  return { reply: data, error };
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
