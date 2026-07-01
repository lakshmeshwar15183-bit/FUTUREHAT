// FUTUREHAT — per-user message extras: star/bookmark and "delete for me".
// Backed by 0011_message_extras (starred_messages, hidden_messages). All calls
// degrade gracefully (return empty / no-op) if the migration isn't applied yet.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, StarredMessage } from './types.js';
import { getCurrentUser } from './api.js';

// ── Starred messages ───────────────────────────────────────────────────────────
export async function getStarredIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('starred_messages').select('message_id');
  return (data ?? []).map((r: any) => r.message_id);
}

/** Full starred-message rows (content + sender + conversation title) across ALL
 *  chats, newest-starred first — backs the "Starred messages" browser. Returns []
 *  if the 0014 function isn't applied yet, so the UI degrades gracefully. */
export async function getStarredMessages(client: SupabaseClient): Promise<StarredMessage[]> {
  const { data, error } = await client.rpc('get_starred_messages');
  if (error) return [];
  return (data as StarredMessage[]) ?? [];
}
export async function starMessage(client: SupabaseClient, messageId: UUID): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client.from('starred_messages').upsert({ user_id: user.id, message_id: messageId });
  return { error };
}
export async function unstarMessage(client: SupabaseClient, messageId: UUID): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client.from('starred_messages').delete().eq('user_id', user.id).eq('message_id', messageId);
  return { error };
}

// ── Delete for me (hide a single message for this user only) ────────────────────
export async function getHiddenMessageIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('hidden_messages').select('message_id');
  return (data ?? []).map((r: any) => r.message_id);
}
export async function hideMessageForMe(client: SupabaseClient, messageId: UUID): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client.from('hidden_messages').upsert({ user_id: user.id, message_id: messageId });
  return { error };
}
