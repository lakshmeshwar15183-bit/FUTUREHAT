// Lumixo — per-user message extras: star/bookmark and "delete for me".
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
  const { error } = await client
    .from('hidden_messages')
    .upsert(
      { user_id: user.id, message_id: messageId },
      { onConflict: 'user_id,message_id', ignoreDuplicates: true },
    );
  return { error };
}

/**
 * WhatsApp "Clear chat" — hide messages for THIS user only, keep the conversation
 * in the chat list. Optionally keep starred messages visible.
 * Does NOT delete media already saved to the device gallery.
 */
export async function clearChatMessagesForMe(
  client: SupabaseClient,
  conversationId: UUID,
  opts?: { keepStarred?: boolean },
): Promise<{ error: Error | null; cleared: number }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated'), cleared: 0 };

  const { data: msgs, error: listErr } = await client
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false);
  if (listErr) return { error: new Error(listErr.message), cleared: 0 };

  let ids = (msgs ?? []).map((m: { id: string }) => m.id);
  if (!ids.length) return { error: null, cleared: 0 };

  if (opts?.keepStarred) {
    const { data: stars } = await client
      .from('starred_messages')
      .select('message_id')
      .eq('user_id', user.id)
      .in('message_id', ids);
    const keep = new Set((stars ?? []).map((r: { message_id: string }) => r.message_id));
    ids = ids.filter((id) => !keep.has(id));
  }

  if (!ids.length) return { error: null, cleared: 0 };

  // Batch upsert (chunk to avoid payload limits on huge threads).
  const chunk = 400;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = slice.map((message_id) => ({ user_id: user.id, message_id }));
    const { error } = await client
      .from('hidden_messages')
      .upsert(rows, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
    if (error) return { error: new Error(error.message), cleared: i };
  }
  return { error: null, cleared: ids.length };
}

/** Conversation ids this user has "deleted for me" (removed from their list).
 *  Free for everyone — backed by deleted_conversations (0016).
 *  Degrades to [] if the migration isn't applied. */
export async function getDeletedConversationIds(client: SupabaseClient): Promise<UUID[]> {
  const { data } = await client.from('deleted_conversations').select('conversation_id');
  return (data ?? []).map((r: any) => r.conversation_id);
}

/**
 * "Delete chat for me" — clears an entire conversation for THIS user only, the
 * WhatsApp way, and works for FREE users. Hides every existing message via
 * hidden_messages (delete-for-me) so the thread reopens empty, then removes the
 * conversation from the list via deleted_conversations. The other participant
 * keeps their full copy. Idempotent; upserts tolerate re-running. Returns the
 * first error encountered, if any.
 */
export async function deleteConversationForMe(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };

  // 1) PRIMARY write — remove the conversation from this user's list. This is
  //    the operation the user actually asked for ("delete chat"); if it fails we
  //    report the real error. It's ungated (deleted_conversations, 0016) and
  //    reversible (the row is dropped when the chat is later revived).
  //
  //    IMPORTANT: use ON CONFLICT DO NOTHING (ignoreDuplicates), NOT a plain
  //    upsert. A default upsert compiles to `INSERT ... ON CONFLICT DO UPDATE`,
  //    whose UPDATE branch is checked against the table's UPDATE RLS policy —
  //    which deleted_conversations deliberately does NOT have. Re-deleting an
  //    already-deleted chat would then hit the (absent) UPDATE policy and fail
  //    with "new row violates row-level security policy (USING expression)".
  //    A row already existing is a success for us (the chat is gone either way),
  //    so DO NOTHING is both correct and immune to the missing UPDATE policy.
  const { error: convErr } = await client
    .from('deleted_conversations')
    .upsert(
      { user_id: user.id, conversation_id: conversationId },
      { onConflict: 'user_id,conversation_id', ignoreDuplicates: true },
    );
  if (convErr) return { error: new Error(convErr.message) };

  // 2) SECONDARY, best-effort — hide every existing message so the thread
  //    reopens empty (WhatsApp behaviour). A failure here (e.g. a very large
  //    thread, or the 0011 table not yet applied) must NOT surface as "could not
  //    delete": the chat is already gone from the list. We simply skip it.
  try {
    const { data: msgs } = await client
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId);
    if (msgs && msgs.length) {
      const rows = msgs.map((m: any) => ({ user_id: user.id, message_id: m.id }));
      await client
        .from('hidden_messages')
        .upsert(rows, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
    }
  } catch {
    /* non-fatal: the conversation is already removed from the list */
  }

  return { error: null };
}

/**
 * "Delete for everyone" at the CONVERSATION level (Telegram-style). Hard-deletes
 * the conversation for ALL participants via the delete_conversation_for_everyone
 * RPC (0018), which re-checks permission server-side: allowed for either member
 * of a direct chat, or the creator of a group. The DB cascades remove every
 * message / participant / receipt, so no orphan rows are left behind.
 */
export async function deleteConversationForEveryone(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('delete_conversation_for_everyone', {
    p_conversation: conversationId,
  });
  return { error: error ? new Error(error.message) : null };
}

/** Whether the current user may "delete for everyone" on this conversation:
 *  direct chats (both members) or groups they created. Cheap client-side gate
 *  for showing the option; the RPC re-checks authoritatively. */
export async function canDeleteForEveryone(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<boolean> {
  const user = await getCurrentUser(client);
  if (!user) return false;
  const { data } = await client
    .from('conversations')
    .select('type, created_by')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data) return false;
  return data.type === 'direct' || data.created_by === user.id;
}
