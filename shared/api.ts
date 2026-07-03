// FUTUREHAT — shared data-access layer
// All chat, auth, and realtime operations. Framework-agnostic; web and mobile both import this.

import type {
  SupabaseClient,
  RealtimeChannel,
  User,
  AuthChangeEvent,
  Session,
} from '@supabase/supabase-js';
import type {
  Profile,
  Message,
  ConversationSummary,
  MessageReceipt,
  MessageReaction,
  Status,
  StatusType,
  StatusViewer,
  UUID,
  MessageType,
} from './types.js';

// ── Auth ────────────────────────────────────────────────────────────────────

export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  displayName: string,
): Promise<{ user: User | null; error: Error | null }> {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
    },
  });
  return { user: data.user, error };
}

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ user: User | null; error: Error | null }> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { user: data.user, error };
}

export async function signOut(client: SupabaseClient): Promise<{ error: Error | null }> {
  const { error } = await client.auth.signOut();
  return { error };
}

export function onAuthChange(
  client: SupabaseClient,
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): { unsubscribe: () => void } {
  const { data } = client.auth.onAuthStateChange(callback);
  return { unsubscribe: data.subscription.unsubscribe };
}

// Return the signed-in user. Reads the LOCAL session (persisted in
// AsyncStorage/localStorage) instead of `auth.getUser()`, which makes a network
// round-trip to /auth/v1/user to re-validate the JWT. Every read path
// (getMyConversations, getMessages bootstrap, sendMessage, markMessageAsRead…)
// calls this, so the network hop added 200–800 ms to *every* operation and was a
// primary cause of the slow chat open. The token is still auto-refreshed by the
// client, so the local session is current; we only need the user id here.
export async function getCurrentUser(client: SupabaseClient): Promise<User | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

// ── Profiles ────────────────────────────────────────────────────────────────

export async function getMyProfile(client: SupabaseClient): Promise<Profile | null> {
  const user = await getCurrentUser(client);
  if (!user) return null;
  const { data } = await client.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

export async function getProfile(
  client: SupabaseClient,
  userId: UUID,
): Promise<Profile | null> {
  const { data } = await client.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export async function updateMyProfile(
  client: SupabaseClient,
  updates: Partial<Pick<Profile, 'display_name' | 'about' | 'avatar_url' | 'username'>>,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const { error } = await client.from('profiles').update(updates).eq('id', user.id);
  return { error };
}

export async function searchProfiles(
  client: SupabaseClient,
  query: string,
): Promise<Profile[]> {
  const { data } = await client
    .from('profiles')
    .select('*')
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(20);
  return data || [];
}

// ── Conversations ───────────────────────────────────────────────────────────

export async function startDirectConversation(
  client: SupabaseClient,
  otherUserId: UUID,
): Promise<{ conversationId: UUID | null; error: Error | null }> {
  const { data, error } = await client.rpc('start_direct_conversation', {
    other_user: otherUserId,
  });
  return { conversationId: data, error };
}

export async function createGroupConversation(
  client: SupabaseClient,
  name: string,
  participantIds: UUID[],
): Promise<{ conversationId: UUID | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { conversationId: null, error: new Error('not authenticated') };

  const { data: conv, error: convErr } = await client
    .from('conversations')
    .insert({ type: 'group', name, created_by: user.id })
    .select('id')
    .single();
  if (convErr || !conv) return { conversationId: null, error: convErr };

  const participants = [user.id, ...participantIds].map((uid) => ({
    conversation_id: conv.id,
    user_id: uid,
    role: uid === user.id ? 'admin' : 'member',
  }));
  const { error: partErr } = await client.from('conversation_participants').insert(participants);
  if (partErr) return { conversationId: null, error: partErr };

  return { conversationId: conv.id, error: null };
}

export async function getMyConversations(
  client: SupabaseClient,
): Promise<ConversationSummary[]> {
  const user = await getCurrentUser(client);
  if (!user) return [];

  // get all conversation IDs I'm part of
  const { data: myParts } = await client
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', user.id);
  if (!myParts || !myParts.length) return [];

  const convIds = myParts.map((p) => p.conversation_id);

  // Batch the "shape" queries: conversations + ALL participant rows for ALL of my
  // conversations in ONE round-trip each (was N separate participant queries in a
  // sequential loop — the main reason the chat list took seconds to load).
  const [convsRes, partsRes] = await Promise.all([
    client.from('conversations').select('*').in('id', convIds),
    client
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds),
  ]);
  const convs = convsRes.data ?? [];
  if (!convs.length) return [];
  const allParts = (partsRes.data ?? []) as { conversation_id: UUID; user_id: UUID }[];

  // One query for every participant profile across all conversations (was N).
  const userIds = [...new Set(allParts.map((p) => p.user_id))];
  const { data: profs } = await client.from('profiles').select('*').in('id', userIds);
  const profById = new Map<UUID, Profile>((profs ?? []).map((p): [UUID, Profile] => [p.id, p as Profile]));
  const partIdsByConv = new Map<UUID, UUID[]>();
  for (const p of allParts) {
    const arr = partIdsByConv.get(p.conversation_id) ?? [];
    arr.push(p.user_id);
    partIdsByConv.set(p.conversation_id, arr);
  }

  // Last-message + unread per conversation, now run in PARALLEL across all
  // conversations instead of sequentially, so total wall-clock is ~1 round-trip
  // rather than N. Per-conversation logic is unchanged.
  const summaries = await Promise.all(
    convs.map(async (conv): Promise<ConversationSummary> => {
      const participantIds = partIdsByConv.get(conv.id) ?? [];
      const profiles = participantIds
        .map((id) => profById.get(id))
        .filter((p): p is Profile => !!p);

      const { data: lastMsg } = await client
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const otherProfiles = profiles.filter((p) => p.id !== user.id);
      const title =
        conv.type === 'group'
          ? conv.name || 'Group'
          : otherProfiles[0]?.display_name || 'Unknown';
      const avatarUrl = conv.type === 'group' ? conv.avatar_url : otherProfiles[0]?.avatar_url;

      // Unread = messages from others in this conversation that I haven't read.
      // Best-effort + clamped: any error or over-count falls back to 0 (never wrong-high).
      let unreadCount = 0;
      if (lastMsg && lastMsg.sender_id !== user.id) {
        try {
          const [fromOthers, readByMe] = await Promise.all([
            client
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('sender_id', user.id),
            client
              .from('message_receipts')
              .select('message_id, messages!inner(conversation_id, sender_id)', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('status', 'read')
              .eq('messages.conversation_id', conv.id)
              .neq('messages.sender_id', user.id),
          ]);
          unreadCount = Math.max(0, (fromOthers.count || 0) - (readByMe.count || 0));
        } catch {
          unreadCount = 0;
        }
      }

      return {
        conversation: conv,
        participants: profiles,
        lastMessage: lastMsg || null,
        unreadCount,
        title,
        avatarUrl,
      };
    }),
  );

  return summaries.sort((a, b) => {
    const aTime = a.lastMessage?.created_at || a.conversation.created_at;
    const bTime = b.lastMessage?.created_at || b.conversation.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

// ── Messages ────────────────────────────────────────────────────────────────

export async function getMessages(
  client: SupabaseClient,
  conversationId: UUID,
  limit = 50,
): Promise<Message[]> {
  const { data } = await client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

/**
 * Media / files shared in a conversation, newest first — backs the "shared
 * media" gallery in contact info. Excludes deleted messages. Best-effort:
 * returns [] on error so callers can render an empty gallery.
 */
export async function getSharedMedia(
  client: SupabaseClient,
  conversationId: UUID,
  limit = 60,
): Promise<Message[]> {
  try {
    const { data } = await client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .in('type', ['image', 'file'])
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).filter((m) => m.media_url);
  } catch {
    return [];
  }
}

/** A message that matched a global search, with its conversation id for routing. */
export interface MessageSearchHit {
  message: Message;
  conversationId: UUID;
}

/**
 * Global message search across all of my conversations (RLS scopes access).
 * Matches non-deleted text content, newest first. Best-effort: [] on error.
 */
export async function searchAllMessages(
  client: SupabaseClient,
  query: string,
  limit = 40,
): Promise<MessageSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const { data } = await client
      .from('messages')
      .select('*')
      .eq('is_deleted', false)
      .ilike('content', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).map((m) => ({ message: m as Message, conversationId: (m as Message).conversation_id }));
  } catch {
    return [];
  }
}

/** A URL anywhere in text — used to classify "link" messages in search filters. */
export const LINK_RE = /https?:\/\/[^\s]+|www\.[^\s]+/i;

/** Message-kind buckets for filtered (media / links / docs / voice) search. */
export type SearchKind = 'all' | 'media' | 'links' | 'docs' | 'voice';
export function messageMatchesKind(m: Message, kind: SearchKind): boolean {
  switch (kind) {
    case 'media': return m.type === 'image' || (m.type === 'file' && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(m.media_url ?? ''));
    case 'links': return m.type === 'text' && LINK_RE.test(m.content ?? '');
    case 'docs': return m.type === 'file' && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(m.media_url ?? '');
    case 'voice': return m.type === 'audio';
    default: return true;
  }
}

export async function sendMessage(
  client: SupabaseClient,
  conversationId: UUID,
  content: string,
  type: MessageType = 'text',
  mediaUrl?: string,
  replyTo?: UUID,
  id?: UUID,
): Promise<{ message: Message | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { message: null, error: new Error('not authenticated') };

  // An explicit client-generated `id` lets the app render the message
  // optimistically and, when the realtime INSERT echoes back, dedupe by the SAME
  // id — so an offline-queued message never appears twice once it finally sends.
  const { data, error } = await client
    .from('messages')
    .insert({
      ...(id ? { id } : {}),
      conversation_id: conversationId,
      sender_id: user.id,
      type,
      content,
      media_url: mediaUrl,
      reply_to: replyTo,
    })
    .select()
    .single();
  return { message: data, error };
}

// Edit a message's text (sets edited_at). RLS allows only the sender.
export async function editMessage(
  client: SupabaseClient,
  messageId: UUID,
  content: string,
): Promise<{ message: Message | null; error: Error | null }> {
  const { data, error } = await client
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .select()
    .single();
  return { message: data, error };
}

// Soft-delete a message (keeps the row so threads/realtime stay consistent).
export async function deleteMessage(
  client: SupabaseClient,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('messages')
    .update({ is_deleted: true, content: null, media_url: null })
    .eq('id', messageId);
  return { error };
}

// Forward an existing message into another conversation as a new message.
export async function forwardMessage(
  client: SupabaseClient,
  targetConversationId: UUID,
  source: Pick<Message, 'type' | 'content' | 'media_url'>,
): Promise<{ message: Message | null; error: Error | null }> {
  const res = await sendMessage(client, targetConversationId, source.content ?? '', source.type, source.media_url ?? undefined);
  // Best-effort "Forwarded" flag — column added in migration 0011; ignore if absent.
  if (res.message && !res.error) {
    await client.from('messages').update({ is_forwarded: true }).eq('id', res.message.id).then(undefined, () => {});
    (res.message as Message).is_forwarded = true;
  }
  return res;
}

export async function markMessageAsRead(
  client: SupabaseClient,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };

  const { error } = await client
    .from('message_receipts')
    .upsert({ message_id: messageId, user_id: user.id, status: 'read' });
  return { error };
}

// Mark an ENTIRE conversation as read (WhatsApp "Mark as read"). Upserts a 'read'
// receipt for every incoming message so the derived unread count (see
// getMyConversations above) drops to zero. Shared by web + mobile, so read state
// stays in sync across devices. No-op when there's nothing from others to read.
export async function markConversationRead(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };

  const { data: msgs, error: selErr } = await client
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id);
  if (selErr) return { error: selErr };
  if (!msgs || msgs.length === 0) return { error: null };

  const rows = msgs.map((m) => ({ message_id: m.id, user_id: user.id, status: 'read' }));
  const { error } = await client.from('message_receipts').upsert(rows);
  return { error };
}

// Fetch all receipts for a set of messages (RLS scopes these to your conversations).
export async function getReceipts(
  client: SupabaseClient,
  messageIds: UUID[],
): Promise<MessageReceipt[]> {
  if (!messageIds.length) return [];
  const { data } = await client
    .from('message_receipts')
    .select('*')
    .in('message_id', messageIds);
  return data || [];
}

// ── Realtime subscriptions ──────────────────────────────────────────────────

export function subscribeToMessages(
  client: SupabaseClient,
  conversationId: UUID,
  onInsert: (message: Message) => void,
  onUpdate?: (message: Message) => void,
): RealtimeChannel {
  const channel = client
    .channel(`messages:${conversationId}`)
    .on<Message>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload: any) => onInsert(payload.new),
    );
  if (onUpdate) {
    channel.on<Message>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload: any) => onUpdate(payload.new),
    );
  }
  return channel.subscribe();
}

// ── Presence (online/offline) ─────────────────────────────────────────────────

// Join the global presence channel; onChange receives the set of online user ids.
export function joinPresence(
  client: SupabaseClient,
  userId: UUID,
  onChange: (onlineIds: Set<string>) => void,
): RealtimeChannel {
  const channel = client.channel('presence:global', { config: { presence: { key: userId } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      onChange(new Set(Object.keys(channel.presenceState())));
    })
    .subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() });
    });
  return channel;
}

// Stamp the user's last_seen (called on a heartbeat and on unload for "last seen").
export async function touchLastSeen(client: SupabaseClient): Promise<void> {
  const user = await getCurrentUser(client);
  if (!user) return;
  await client.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', user.id);
}

// Subscribe to receipt changes. RLS restricts the stream to messages in
// conversations you belong to, so we filter to the ones we care about in the callback.
export function subscribeToReceipts(
  client: SupabaseClient,
  conversationId: UUID,
  onChange: (receipt: MessageReceipt) => void,
): RealtimeChannel {
  return client
    .channel(`receipts:${conversationId}`)
    .on<MessageReceipt>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_receipts' },
      (payload: any) => onChange(payload.new),
    )
    .subscribe();
}

// ── Reactions ─────────────────────────────────────────────────────────────────

export async function getReactions(
  client: SupabaseClient,
  messageIds: UUID[],
): Promise<MessageReaction[]> {
  if (!messageIds.length) return [];
  const { data } = await client
    .from('message_reactions')
    .select('*')
    .in('message_id', messageIds);
  return data || [];
}

// Add or remove a reaction (toggles your own emoji on a message).
export async function toggleReaction(
  client: SupabaseClient,
  messageId: UUID,
  emoji: string,
): Promise<{ added: boolean; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { added: false, error: new Error('not authenticated') };

  const { data: existing } = await client
    .from('message_reactions')
    .select('emoji')
    .eq('message_id', messageId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
    return { added: false, error };
  }

  const { error } = await client
    .from('message_reactions')
    .insert({ message_id: messageId, user_id: user.id, emoji });
  return { added: true, error };
}

export function subscribeToReactions(
  client: SupabaseClient,
  conversationId: UUID,
  onChange: () => void,
): RealtimeChannel {
  return client
    .channel(`reactions:${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      () => onChange(),
    )
    .subscribe();
}

// ── Typing indicators (realtime broadcast — no DB writes) ─────────────────────

export interface TypingPayload {
  userId: UUID;
  name: string;
  typing: boolean;
}

export function createTypingChannel(
  client: SupabaseClient,
  conversationId: UUID,
  onTyping: (payload: TypingPayload) => void,
): { channel: RealtimeChannel; notify: (payload: TypingPayload) => void } {
  const channel = client.channel(`typing:${conversationId}`, {
    config: { broadcast: { self: false } },
  });
  channel
    .on('broadcast', { event: 'typing' }, ({ payload }: any) => onTyping(payload))
    .subscribe();

  return {
    channel,
    notify: (payload: TypingPayload) =>
      channel.send({ type: 'broadcast', event: 'typing', payload }),
  };
}

// ── Status/Stories ──────────────────────────────────────────────────────────

// Active (non-expired) statuses, newest first, with the author's profile joined
// so the tray can show names/avatars without N extra round-trips.
export async function getActiveStatuses(client: SupabaseClient): Promise<Status[]> {
  const { data, error } = await client
    .from('statuses')
    .select('*, profile:profiles!statuses_user_id_fkey(id, display_name, avatar_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  // Fall back to the unjoined query if the FK alias isn't recognised (older schema cache).
  if (error) {
    const { data: plain } = await client
      .from('statuses')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return (plain as Status[]) || [];
  }
  return ((data || []) as unknown[]).map((row) => {
    const r = row as Status & { profile?: unknown };
    return { ...r, profile: flattenJoin(r.profile) } as Status;
  });
}

// PostgREST returns embedded one-to-one joins as either an object or a 1-element
// array depending on schema-cache state; normalise to a single object.
function flattenJoin<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

export async function createStatus(
  client: SupabaseClient,
  type: StatusType,
  content?: string,
  mediaUrl?: string,
  background?: string,
): Promise<{ status: Status | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { status: null, error: new Error('not authenticated') };

  const { data, error } = await client
    .from('statuses')
    .insert({ user_id: user.id, type, content, media_url: mediaUrl, background })
    .select()
    .single();
  return { status: data, error };
}

// Delete one of your own statuses (RLS enforces ownership).
export async function deleteStatus(
  client: SupabaseClient,
  statusId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client.from('statuses').delete().eq('id', statusId);
  return { error };
}

// Record that the current user has viewed a status. Idempotent (PK upsert);
// no-op on your own status to keep the "seen by" list to genuine viewers.
export async function markStatusViewed(
  client: SupabaseClient,
  statusId: UUID,
  ownerId?: UUID,
): Promise<void> {
  const user = await getCurrentUser(client);
  if (!user || user.id === ownerId) return;
  await client
    .from('status_views')
    .upsert({ status_id: statusId, viewer_id: user.id }, { onConflict: 'status_id,viewer_id' });
}

// Status ids the current user has already viewed — used to render seen/unseen rings.
export async function getMyViewedStatusIds(client: SupabaseClient): Promise<Set<UUID>> {
  const user = await getCurrentUser(client);
  if (!user) return new Set();
  const { data } = await client
    .from('status_views')
    .select('status_id')
    .eq('viewer_id', user.id);
  return new Set((data || []).map((r: { status_id: UUID }) => r.status_id));
}

// The "seen by" list for one of your statuses (RLS only returns rows the owner may read).
export async function getStatusViewers(
  client: SupabaseClient,
  statusId: UUID,
): Promise<StatusViewer[]> {
  const { data } = await client
    .from('status_views')
    .select('viewer_id, viewed_at, profile:profiles!status_views_viewer_id_fkey(id, display_name, avatar_url)')
    .eq('status_id', statusId)
    .order('viewed_at', { ascending: false });
  return ((data || []) as unknown[]).map((row) => {
    const r = row as StatusViewer & { profile?: unknown };
    return { ...r, profile: flattenJoin(r.profile) } as StatusViewer;
  });
}

// ── Storage (media uploads) ─────────────────────────────────────────────────

// `file` is File | Blob on web; on React Native we pass a decoded ArrayBuffer
// plus an explicit contentType (RN has no File/Blob upload that reliably works
// against Supabase storage). Keeping one implementation avoids duplicating the
// bucket/path/public-url logic across platforms.
export async function uploadMedia(
  client: SupabaseClient,
  conversationId: UUID,
  file: File | Blob | ArrayBuffer,
  fileName: string,
  contentType?: string,
): Promise<{ url: string | null; error: Error | null }> {
  const ext = fileName.split('.').pop() || 'bin';
  const path = `${conversationId}/${Date.now()}.${ext}`;
  const { error } = await client.storage
    .from('media')
    .upload(path, file as Blob, contentType ? { contentType } : undefined);
  if (error) return { url: null, error };

  const { data } = client.storage.from('media').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function uploadAvatar(
  client: SupabaseClient,
  userId: UUID,
  file: File | Blob | ArrayBuffer,
  contentType = 'image/jpeg',
): Promise<{ url: string | null; error: Error | null }> {
  const ext = 'jpg'; // force JPEG for avatars
  const path = `${userId}/avatar.${ext}`;
  const { error } = await client.storage
    .from('avatars')
    .upload(path, file as Blob, { upsert: true, contentType });
  if (error) return { url: null, error };

  const { data } = client.storage.from('avatars').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}
