// Lumixo — shared data-access layer
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
  StatusAudience,
  StatusViewer,
  UUID,
  MessageType,
  MediaMeta,
  ViewOnceState,
} from './types.js';
import {
  aggregateRecipientTick,
  type TickStatus,
} from './messageStatus.js';
import {
  resolveConversationTitle,
  resolveConversationAvatar,
  resolveDisplayName,
  mergeProfileIdentity,
} from './identity.js';

// Re-export tick helpers so web/mobile can import from the shared API barrel.
export {
  type TickStatus,
  type ReceiptLike,
  tickRank,
  maxTick,
  mergeTick,
  receiptStatusToTick,
  aggregateRecipientTick,
  buildTickMap,
  applyReceiptToTickMap,
  computeOutboundTick,
  tickIsDouble,
  tickIsRead,
  tickLabel,
  tickGlyph,
} from './messageStatus.js';

export {
  type IdentityLike,
  resolveDisplayName,
  resolveUsernameHandle,
  resolveAvatarUrl,
  mergeProfileIdentity,
  resolveConversationTitle,
  resolveConversationAvatar,
  isWeakLabel,
  isWeakTitle,
  cleanLabel,
  mergeConversationIdentityFields,
  stabilizeConversationList,
} from './identity.js';

export {
  type NicknameMap,
  normalizeNickname,
  nicknameStorageKey,
  setNicknameInMap,
  getNicknameFromMap,
} from './nicknames.js';

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

/** Safe peer-facing columns — never phone, account_status, ban fields, role. */
export const PROFILE_PUBLIC_COLS =
  'id, username, display_name, about, avatar_url, last_seen, created_at';

/** Own account columns (phone OK — RLS: own row only). */
const PROFILE_SELF_COLS =
  'id, phone, username, display_name, about, avatar_url, last_seen, created_at';

/**
 * Batch-load peer profiles without phone. Uses public_profiles (0050/0051);
 * falls back to column-limited profiles select if the view is missing.
 *
 * Chunked `.in()` queries — large participant graphs were silently truncating /
 * failing PostgREST URL limits, leaving holes that became "Unknown" titles.
 */
export async function getProfilesPublic(
  client: SupabaseClient,
  userIds: UUID[],
): Promise<Map<UUID, Profile>> {
  const map = new Map<UUID, Profile>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;

  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await client
      .from('public_profiles')
      .select(PROFILE_PUBLIC_COLS)
      .in('id', slice);
    if (!error && data) {
      for (const p of data as Profile[]) map.set(p.id, { ...p, phone: null });
      continue;
    }
    // Fallback: never select * or phone.
    const { data: rows } = await client
      .from('profiles')
      .select(PROFILE_PUBLIC_COLS)
      .in('id', slice);
    for (const p of (rows as Profile[]) ?? []) map.set(p.id, { ...p, phone: null });
  }
  return map;
}

export async function getMyProfile(client: SupabaseClient): Promise<Profile | null> {
  const user = await getCurrentUser(client);
  if (!user) return null;
  // Own row only — phone allowed for account UI. Never used for peer display.
  const { data } = await client
    .from('profiles')
    .select(PROFILE_SELF_COLS)
    .eq('id', user.id)
    .single();
  return data as Profile | null;
}

export async function getProfile(
  client: SupabaseClient,
  userId: UUID,
): Promise<Profile | null> {
  // public_profiles omits phone / ban fields (0050/0051).
  const { data, error } = await client
    .from('public_profiles')
    .select(PROFILE_PUBLIC_COLS)
    .eq('id', userId)
    .maybeSingle();
  if (!error && data) return { ...(data as Profile), phone: null };
  // Self or admin path / pre-0050: limited columns on base table (never select *).
  const { data: row } = await client
    .from('profiles')
    .select(PROFILE_PUBLIC_COLS)
    .eq('id', userId)
    .maybeSingle();
  return row ? { ...(row as Profile), phone: null } : null;
}

/** Full own profile including phone (account settings). RLS: own row only. */
export async function getMyFullProfile(
  client: SupabaseClient,
): Promise<(Profile & { phone?: string | null }) | null> {
  const user = await getCurrentUser(client);
  if (!user) return null;
  const { data } = await client
    .from('profiles')
    .select('id, phone, username, display_name, about, avatar_url, last_seen, created_at')
    .eq('id', user.id)
    .maybeSingle();
  return data as Profile | null;
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

/** Strip PostgREST filter metacharacters so user input cannot break `.or()` / `.ilike()`. */
function sanitizeSearchTerm(raw: string, maxLen = 64): string {
  return raw
    .trim()
    .slice(0, maxLen)
    .replace(/[%_,.()"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchProfiles(
  client: SupabaseClient,
  query: string,
): Promise<Profile[]> {
  const q = sanitizeSearchTerm(query);
  if (q.length < 1) return [];
  // Prefer public_profiles (no phone/moderation columns) when the view exists;
  // fall back to profiles for older DBs.
  const { data, error } = await client
    .from('public_profiles')
    .select('id, username, display_name, about, avatar_url, last_seen, created_at')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(20);
  if (!error && data) return data as Profile[];
  const { data: fallback } = await client
    .from('profiles')
    .select('id, username, display_name, about, avatar_url, last_seen, created_at')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(20);
  return (fallback as Profile[]) || [];
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
  avatarUrl?: string | null,
  description?: string | null,
): Promise<{ conversationId: UUID | null; error: Error | null }> {
  // Delegates to the SECURITY DEFINER RPC (0033, extended in 0037). Prefer the
  // full groupsApi helper when you need push notify + description; this keeps
  // the historic import path working for both web and mobile create flows.
  const { data, error } = await client.rpc('create_group_conversation', {
    p_name: name,
    p_member_ids: participantIds,
    p_avatar_url: avatarUrl ?? null,
    p_description: description ?? null,
  });
  if (error) return { conversationId: null, error: new Error(error.message) };
  // Callers (NewGroupScreen / GroupModal) fire sendPush for "added to group".
  return { conversationId: (data as UUID) ?? null, error: null };
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

  // One query for every participant profile — public_profiles only (no phone).
  const userIds = [...new Set(allParts.map((p) => p.user_id))];
  const profById = await getProfilesPublic(client, userIds);
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

      // Skip unsent (is_deleted) messages so the chat-list preview shows the last
      // REAL message — an unsent message vanishes here too (Instagram-style), never
      // leaving a "deleted" preview behind.
      const { data: lastMsg } = await client
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const otherProfiles = profiles.filter((p) => p.id !== user.id);
      // Identity: never fall back to the string "Unknown" when a profile exists
      // but display_name is empty — use username / Contact via resolveConversationTitle.
      // Missing profile rows (chunk/RLS race) → "Contact", not "Unknown"; list merge
      // with local cache restores the previous good name.
      const title = resolveConversationTitle(conv, otherProfiles);
      const avatarUrl = resolveConversationAvatar(conv, otherProfiles);

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
        // Filled below from a batched receipts query (single source of truth).
        lastMessageTick: null,
      };
    }),
  );

  // Attach outbound ticks for last messages I sent so chat list + chat thread
  // always agree (never hardcode double-ticks in the list UI).
  const myLastIds = summaries
    .map((s) => s.lastMessage)
    .filter((m): m is Message => !!m && m.sender_id === user.id && !m.is_deleted && m.type !== 'system')
    .map((m) => m.id);

  if (myLastIds.length > 0) {
    const receipts = await getReceipts(client, myLastIds);
    for (const s of summaries) {
      const m = s.lastMessage;
      if (!m || m.sender_id !== user.id || m.is_deleted || m.type === 'system') {
        s.lastMessageTick = null;
        continue;
      }
      s.lastMessageTick = aggregateRecipientTick(receipts, m.id, user.id);
    }
  }

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
    // Disappearing messages (0022): never fetch ones that already expired.
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

// ── Disappearing messages (0022) ─────────────────────────────────────────────

/** Set (or clear) a conversation's disappearing-messages timer. `seconds` is
 *  0 (off) or 3600..28800 (1–8h). Member-gated server-side via `set_disappearing`.
 *  New messages carry a per-message `expires_at` snapshot from this setting. */
export async function setConversationDisappearing(
  client: SupabaseClient,
  conversationId: UUID,
  seconds: number,
): Promise<{ error: Error | null }> {
  const { error } = await client.rpc('set_disappearing', {
    conv: conversationId,
    secs: seconds,
  });
  return { error };
}

/** Current disappearing-messages timer for a conversation (0 = off). Best-effort:
 *  returns 0 on error or before the migration is applied. */
export async function getDisappearing(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<number> {
  try {
    const { data } = await client
      .from('conversations')
      .select('disappear_seconds')
      .eq('id', conversationId)
      .single();
    return (data as { disappear_seconds?: number } | null)?.disappear_seconds ?? 0;
  } catch {
    return 0;
  }
}

/** Opportunistic physical cleanup of expired messages in the caller's own
 *  conversations. Best-effort: swallows errors (clients also hide expired live). */
export async function purgeExpiredMessages(client: SupabaseClient): Promise<number> {
  try {
    const { data } = await client.rpc('purge_expired_messages');
    return typeof data === 'number' ? data : 0;
  } catch {
    return 0;
  }
}

/** True when a message has passed its disappearing expiry at `now` (ms epoch).
 *  Messages with no `expires_at` never expire. */
export function messageExpired(m: Message, now: number = Date.now()): boolean {
  return !!m.expires_at && new Date(m.expires_at).getTime() <= now;
}

/** Soonest future `expires_at` across a list, as ms epoch, or null when none.
 *  Drives a single self-rescheduling expiry timer (mirrors status strips). */
export function nextMessageExpiry(messages: Message[], now: number = Date.now()): number | null {
  let soonest: number | null = null;
  for (const m of messages) {
    if (!m.expires_at) continue;
    const t = new Date(m.expires_at).getTime();
    if (t > now && (soonest === null || t < soonest)) soonest = t;
  }
  return soonest;
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
      .in('type', ['image', 'video', 'file'])
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
  const q = sanitizeSearchTerm(query, 100);
  if (!q) return [];
  try {
    const { data } = await client
      .from('messages')
      .select('*')
      .eq('is_deleted', false)
      .ilike('content', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
    return (data || []).map((m) => ({ message: m as Message, conversationId: (m as Message).conversation_id }));
  } catch {
    return [];
  }
}

/** A URL anywhere in text — used to classify "link" messages in search filters. */
export const LINK_RE = /https?:\/\/[^\s]+|www\.[^\s]+/i;

/** Canonical video-file detector. Shared by web + mobile so detection never
 *  diverges. Used both to render first-class `type='video'` messages and to
 *  keep treating legacy `type='file'` rows that carry a video URL as video. */
export const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i;
export function isVideoUrl(url?: string | null): boolean {
  return !!url && VIDEO_RE.test(url);
}
/** True for any message that should render/behave as a video — the first-class
 *  type OR a legacy file row with a video URL. */
export function isVideoMessage(m: Pick<Message, 'type' | 'media_url'>): boolean {
  return m.type === 'video' || (m.type === 'file' && isVideoUrl(m.media_url));
}

/** Message-kind buckets for filtered (media / links / docs / voice) search. */
export type SearchKind = 'all' | 'media' | 'links' | 'docs' | 'voice';
export function messageMatchesKind(m: Message, kind: SearchKind): boolean {
  switch (kind) {
    case 'media': return m.type === 'image' || isVideoMessage(m);
    case 'links': return m.type === 'text' && LINK_RE.test(m.content ?? '');
    case 'docs': return m.type === 'file' && !isVideoUrl(m.media_url);
    case 'voice': return m.type === 'audio';
    default: return true;
  }
}

const MAX_MESSAGE_CHARS = 16000;
// Never include 'system' — clients cannot forge system messages (DB + client).
const ALLOWED_MESSAGE_TYPES = new Set<MessageType>([
  'text', 'image', 'video', 'file', 'audio',
]);

export async function sendMessage(
  client: SupabaseClient,
  conversationId: UUID,
  content: string,
  type: MessageType = 'text',
  mediaUrl?: string,
  replyTo?: UUID,
  id?: UUID,
  mediaMeta?: MediaMeta,
): Promise<{ message: Message | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { message: null, error: new Error('not authenticated') };
  if (!conversationId) return { message: null, error: new Error('missing conversation') };
  // Clients must not forge system messages or unknown types.
  if (type === 'system' || !ALLOWED_MESSAGE_TYPES.has(type)) {
    return { message: null, error: new Error('invalid message type') };
  }
  if (content && content.length > MAX_MESSAGE_CHARS) {
    return { message: null, error: new Error('message too long') };
  }

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
      content: content ?? null,
      media_url: mediaUrl,
      reply_to: replyTo,
      // Only send media_meta when provided & non-empty, so text messages and the
      // pre-0030 clients stay byte-identical (column defaults to '{}').
      ...(mediaMeta && Object.keys(mediaMeta).length ? { media_meta: mediaMeta } : {}),
    })
    .select()
    .single();
  return { message: data, error };
}

// ── View Once (0030) ──────────────────────────────────────────────────────────
// Mark a View-Once message as opened by the current user. Server-authoritative and
// idempotent: the FIRST recipient open records the view (first_view=true); later
// opens (or the sender) report consumed. Returns null on error (caller decides UX).
export async function markViewOnceSeen(
  client: SupabaseClient,
  messageId: UUID,
): Promise<ViewOnceState | null> {
  const { data, error } = await client.rpc('mark_view_once_seen', { p_message: messageId });
  if (error) return null;
  return data as ViewOnceState;
}

// Read-only: may the current user still open this View-Once message? (no consume)
export async function getViewOnceState(
  client: SupabaseClient,
  messageId: UUID,
): Promise<ViewOnceState | null> {
  const { data, error } = await client.rpc('view_once_state', { p_message: messageId });
  if (error) return null;
  return data as ViewOnceState;
}

// Edit a message's text (sets edited_at). RLS allows only the sender.
// Never edit system messages (DB also freezes them; this is defense-in-depth).
export async function editMessage(
  client: SupabaseClient,
  messageId: UUID,
  content: string,
): Promise<{ message: Message | null; error: Error | null }> {
  const { data: existing } = await client
    .from('messages')
    .select('id, type, sender_id')
    .eq('id', messageId)
    .maybeSingle();
  if (!existing) return { message: null, error: new Error('message not found') };
  if ((existing as { type?: string }).type === 'system') {
    return { message: null, error: new Error('system messages cannot be edited') };
  }
  const { data, error } = await client
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .neq('type', 'system')
    .select()
    .single();
  return { message: data, error };
}

// Soft-delete a message (keeps the row so threads/realtime stay consistent).
// System messages are immutable in DB; filter client-side too.
export async function deleteMessage(
  client: SupabaseClient,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const { error } = await client
    .from('messages')
    .update({ is_deleted: true, content: null, media_url: null })
    .eq('id', messageId)
    .neq('type', 'system');
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

/**
 * Mark a message as delivered to THIS device (grey double-tick for the sender).
 * Insert-only on conflict: never downgrades an existing `read` receipt.
 * Call when the recipient's client first receives the message (realtime, push,
 * or history load) — not only when they open the chat.
 */
export async function markMessageAsDelivered(
  client: SupabaseClient,
  messageId: UUID,
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };

  const { error } = await client.from('message_receipts').upsert(
    { message_id: messageId, user_id: user.id, status: 'delivered' },
    { onConflict: 'message_id,user_id', ignoreDuplicates: true },
  );
  return { error };
}

/** Mark many messages delivered (batch). Same non-downgrade semantics. */
export async function markMessagesAsDelivered(
  client: SupabaseClient,
  messageIds: UUID[],
): Promise<{ error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { error: new Error('not authenticated') };
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length) return { error: null };

  const rows = ids.map((message_id) => ({
    message_id,
    user_id: user.id,
    status: 'delivered' as const,
  }));
  const { error } = await client
    .from('message_receipts')
    .upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  return { error };
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

/**
 * Resolve the outbound tick for a single message id (list preview / deep link).
 * Uses the same aggregate as getMyConversations / chat bubbles.
 */
export async function getMessageTick(
  client: SupabaseClient,
  messageId: UUID,
  senderId?: string | null,
): Promise<TickStatus> {
  const receipts = await getReceipts(client, [messageId]);
  const me = senderId ?? (await getCurrentUser(client))?.id ?? null;
  return aggregateRecipientTick(receipts, messageId, me);
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
// Shared global-presence room. Multiple screens (chat list + open conversation)
// all want "who's online", but Supabase forbids two subscriptions to the same
// channel topic on one client — and adding an `.on('presence')` listener to an
// already-subscribed channel throws ("cannot add presence callbacks ... after
// subscribe()"), crashing the second screen to mount. So we keep ONE channel per
// topic and fan out sync events to every subscriber, ref-counting so the channel
// is torn down only when the last screen leaves.
interface PresenceRoom {
  channel: RealtimeChannel;
  subscribers: Set<(onlineIds: Set<string>) => void>;
  online: Set<string>;
}
const presenceRooms = new Map<string, PresenceRoom>();
const PRESENCE_TOPIC = 'presence:global';

/**
 * Join the shared global presence room. `onChange` fires with the current set of
 * online user ids on every sync. Returns a RealtimeChannel-shaped handle whose
 * only meaningful method is the one `supabase.removeChannel()` needs — but callers
 * should simply pass it back to removeChannel() on cleanup as before; this
 * unsubscribes just THIS listener and tears the channel down when it's the last.
 */
export function joinPresence(
  client: SupabaseClient,
  userId: UUID,
  onChange: (onlineIds: Set<string>) => void,
): RealtimeChannel {
  let room = presenceRooms.get(PRESENCE_TOPIC);

  if (!room) {
    // First subscriber: create + subscribe the single shared channel.
    const channel = client.channel(PRESENCE_TOPIC, { config: { presence: { key: userId } } });
    const created: PresenceRoom = { channel, subscribers: new Set(), online: new Set() };
    channel
      .on('presence', { event: 'sync' }, () => {
        created.online = new Set(Object.keys(channel.presenceState()));
        created.subscribers.forEach((cb) => cb(created.online));
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() });
      });
    presenceRooms.set(PRESENCE_TOPIC, created);
    room = created;
  }

  room.subscribers.add(onChange);
  // Hand the newcomer the state we already have so it paints immediately.
  if (room.online.size) onChange(new Set(room.online));

  // Return a PER-CALLER handle whose __unsubscribePresence removes exactly THIS
  // caller's onChange. Crucially we do NOT stamp this onto the shared
  // room.channel: that object is reused across every subscriber, so mutating it
  // would overwrite the previous caller's unsubscribe closure — and then leaving
  // one screen would remove another screen's callback, leaving an UNMOUNTED
  // screen's setState listener alive in the room (state-update-after-unmount +
  // a slow subscriber leak). A fresh object per caller keeps each cleanup exact.
  // leavePresence() only ever reads __unsubscribePresence, so a lightweight
  // handle is sufficient.
  const handle = {
    __unsubscribePresence: () => {
      const r = presenceRooms.get(PRESENCE_TOPIC);
      if (!r) return;
      r.subscribers.delete(onChange);
      if (r.subscribers.size === 0) {
        presenceRooms.delete(PRESENCE_TOPIC);
        void client.removeChannel(r.channel);
      }
    },
  } as unknown as RealtimeChannel;
  return handle;
}

/**
 * Leave the shared presence room for one subscriber. Prefer this over
 * supabase.removeChannel(joinPresenceHandle) so the shared channel survives while
 * other screens still need it. Safe to call with any channel; no-ops if it isn't
 * a presence handle.
 */
export function leavePresence(channel: RealtimeChannel | null | undefined): void {
  const handle = channel as (RealtimeChannel & { __unsubscribePresence?: () => void }) | null | undefined;
  handle?.__unsubscribePresence?.();
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

// ── Conversation removals (delete-for-me / delete-for-everyone sync) ───────────
// Fires when a conversation should leave THIS user's list — on ANY of their
// devices — without a manual refresh:
//   • a `conversation_participants` row of theirs is deleted (delete-for-everyone
//     cascades these away, or they were removed from a group), or
//   • a `deleted_conversations` row of theirs is inserted (they hit "Delete for
//     me" on another device).
// It hands the caller the affected conversation id; the caller drops it from the
// list + cache. Realtime DELETE payloads carry only the replica-identity columns
// (the composite PK here — conversation_id + user_id), which is exactly what we
// need to (a) confirm the row is this user's and (b) know which chat to remove.
export function subscribeToConversationRemovals(
  client: SupabaseClient,
  userId: UUID,
  onRemove: (conversationId: UUID) => void,
): RealtimeChannel {
  return client
    .channel(`conv-removals:${userId}`)
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'conversation_participants' },
      (payload: any) => {
        const row = payload.old ?? {};
        // DELETE payloads include the PK; ignore rows that aren't ours.
        if (row.user_id && row.user_id !== userId) return;
        if (row.conversation_id) onRemove(row.conversation_id);
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'deleted_conversations', filter: `user_id=eq.${userId}` },
      (payload: any) => {
        const row = payload.new ?? {};
        if (row.conversation_id) onRemove(row.conversation_id);
      },
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

// Extra attributes for a status. All optional and backward-compatible — existing
// callers that pass only (type, content, mediaUrl, background) keep working.
export interface CreateStatusOpts {
  caption?: string;                 // image/video/audio caption
  textColor?: string;               // custom text-status color
  durationMs?: number;              // audio/video length
  audience?: StatusAudience;        // privacy audience; defaults to 'everyone'
  memberIds?: UUID[];               // for audience 'except' / 'only' — snapshotted
}

export async function createStatus(
  client: SupabaseClient,
  type: StatusType,
  content?: string,
  mediaUrl?: string,
  background?: string,
  opts?: CreateStatusOpts,
): Promise<{ status: Status | null; error: Error | null }> {
  const user = await getCurrentUser(client);
  if (!user) return { status: null, error: new Error('not authenticated') };

  const audience = opts?.audience ?? 'everyone';
  const { data, error } = await client
    .from('statuses')
    .insert({
      user_id: user.id,
      type,
      content,
      media_url: mediaUrl,
      background,
      caption: opts?.caption ?? null,
      text_color: opts?.textColor ?? null,
      duration_ms: opts?.durationMs ?? null,
      audience,
    })
    .select()
    .single();
  if (error || !data) return { status: data ?? null, error };

  // Snapshot the Except / Only member list for this status so privacy is
  // enforced consistently even if the user later changes their default.
  if ((audience === 'except' || audience === 'only') && opts?.memberIds?.length) {
    const rows = opts.memberIds.map((uid) => ({ status_id: (data as Status).id, user_id: uid }));
    const { error: audErr } = await client.from('status_audience').insert(rows);
    if (audErr) return { status: data as Status, error: audErr };
  }
  return { status: data as Status, error: null };
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

// Cheap viewer count for one of your statuses (no row payload transferred).
export async function getStatusViewCount(client: SupabaseClient, statusId: UUID): Promise<number> {
  const { count } = await client
    .from('status_views')
    .select('*', { count: 'exact', head: true })
    .eq('status_id', statusId);
  return count ?? 0;
}

// Opportunistic physical cleanup of expired statuses (RLS already hides them).
// Safe for any client to call; returns how many rows were purged.
export async function purgeExpiredStatuses(client: SupabaseClient): Promise<number> {
  const { data } = await client.rpc('purge_expired_statuses');
  return (data as number) ?? 0;
}

// Realtime: fire `cb` whenever any status row is inserted/deleted, so the tray
// strip and viewer can drop expired/removed statuses and surface new ones live
// without polling. status/status_views are already in the supabase_realtime
// publication (0002 / 0012).
//
// CP5 perf pass: this used to open a FRESH `status-changes` channel per caller.
// Supabase forbids two subscriptions to the same topic on one client, and every
// INSERT/DELETE fired an *immediate* full refetch — so a burst of status writes
// (e.g. your own post echoing back while `onPosted` also reloads) triggered a
// refetch storm. We now keep ONE shared channel per client, ref-counted like the
// presence room above, and DEBOUNCE the fan-out so rapid changes coalesce into a
// single reload. Callers get a `{ unsubscribe }` handle; the channel is torn down
// only when the last subscriber leaves.
interface StatusChangesRoom {
  channel: RealtimeChannel;
  subscribers: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}
let statusChangesRoom: StatusChangesRoom | null = null;
const STATUS_CHANGE_DEBOUNCE_MS = 250;

export function subscribeStatusChanges(
  client: SupabaseClient,
  cb: () => void,
): { unsubscribe: () => void } {
  if (!statusChangesRoom) {
    const room: StatusChangesRoom = {
      channel: null as unknown as RealtimeChannel,
      subscribers: new Set(),
      timer: null,
    };
    const fire = () => {
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => {
        room.timer = null;
        room.subscribers.forEach((s) => s());
      }, STATUS_CHANGE_DEBOUNCE_MS);
    };
    room.channel = client
      .channel('status-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'statuses' }, fire)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'statuses' }, fire)
      .subscribe();
    statusChangesRoom = room;
  }

  const room = statusChangesRoom;
  room.subscribers.add(cb);
  return {
    unsubscribe: () => {
      const r = statusChangesRoom;
      if (!r) return;
      r.subscribers.delete(cb);
      if (r.subscribers.size === 0) {
        if (r.timer) clearTimeout(r.timer);
        void client.removeChannel(r.channel);
        statusChangesRoom = null;
      }
    },
  };
}

// Realtime: fire `cb` when a new view is recorded on one of the current user's
// statuses (drives a live "seen by" count/list). RLS already limits which
// status_views rows the owner receives.
export function subscribeStatusViews(
  client: SupabaseClient,
  statusId: UUID,
  cb: () => void,
): RealtimeChannel {
  return client
    .channel(`status-views:${statusId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'status_views', filter: `status_id=eq.${statusId}` },
      () => cb(),
    )
    .subscribe();
}

// ── Storage (media uploads) ─────────────────────────────────────────────────

// `file` is File | Blob on web; on React Native we pass a decoded ArrayBuffer
// plus an explicit contentType (RN has no File/Blob upload that reliably works
// against Supabase storage). Keeping one implementation avoids duplicating the
// bucket/path/public-url logic across platforms.
/** Allowed media extensions (block executables / scripts). */
const SAFE_MEDIA_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'mp4', 'mov', 'webm', 'm4v',
  'm4a', 'mp3', 'aac', 'ogg', 'wav', 'opus',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip',
]);

const SAFE_MIME_PREFIX = /^(image\/|video\/|audio\/|application\/pdf|application\/zip|application\/msword|application\/vnd\.|text\/plain|text\/csv)/i;

function assertSafeUpload(
  fileName: string,
  contentType?: string,
  byteLength?: number,
): Error | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ext || !SAFE_MEDIA_EXT.has(ext)) {
    return new Error('unsupported file type');
  }
  if (
    contentType &&
    contentType !== 'application/octet-stream' &&
    !SAFE_MIME_PREFIX.test(contentType)
  ) {
    return new Error('unsupported content type');
  }
  // Hard ceiling matches premium max (2 GB). Free/premium soft limits are
  // enforced in the client via FREE_LIMITS / PREMIUM_LIMITS.
  if (typeof byteLength === 'number' && byteLength > 2 * 1024 * 1024 * 1024) {
    return new Error('file too large');
  }
  // Block double extensions like evil.pdf.exe
  const base = fileName.toLowerCase();
  if (/\.(exe|bat|cmd|sh|apk|dex|js|html|htm|svg|php|asp|aspx|dll|so|msi|scr|ps1)(\.|$)/i.test(base)) {
    return new Error('unsupported file type');
  }
  return null;
}

export async function uploadMedia(
  client: SupabaseClient,
  conversationId: UUID,
  file: File | Blob | ArrayBuffer,
  fileName: string,
  contentType?: string,
): Promise<{ url: string | null; error: Error | null }> {
  if (!conversationId || !/^[0-9a-fA-F-]{36}$/.test(conversationId)) {
    return { url: null, error: new Error('invalid conversation') };
  }
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file.bin';
  const byteLength =
    typeof (file as ArrayBuffer).byteLength === 'number'
      ? (file as ArrayBuffer).byteLength
      : typeof (file as Blob).size === 'number'
        ? (file as Blob).size
        : undefined;
  const bad = assertSafeUpload(safeName, contentType, byteLength);
  if (bad) return { url: null, error: bad };

  const ext = safeName.split('.').pop() || 'bin';
  const path = `${conversationId}/${Date.now()}.${ext}`;
  const { error } = await client.storage
    .from('media')
    .upload(path, file as Blob, contentType ? { contentType } : undefined);
  if (error) return { url: null, error };

  const { data } = client.storage.from('media').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// ── Signed media URLs ───────────────────────────────────────────────────────
// The `media` bucket is PRIVATE (migrations 0002/0015 — read is scoped to
// conversation membership via RLS). A `getPublicUrl()` link therefore hits the
// `/object/public/media/…` endpoint, which returns 400/403 for a private bucket
// no matter the RLS — the classic "image renders as a black screen" bug. The fix
// is to serve media through short-lived SIGNED urls, which honour RLS. We keep
// storing the public url (so old rows and the DB shape don't change) and resolve
// it to a signed url at render time via `signedMediaUrl` below.

/** Extract the object path (`<conv>/<file>`) from a stored media-bucket URL.
 *  Handles both `/object/public/media/…` and `/object/sign/media/…` forms.
 *  Returns null for anything that isn't a media-bucket URL (data URIs, stickers,
 *  external links, local `file://` uris) so callers can pass those through. */
export function mediaPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?media\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Cache signed urls in-memory keyed by object path, with their expiry, so we make
// at most one createSignedUrl round-trip per media item per hour and expo-image's
// url-keyed cache keeps hitting (a fresh token every render would bust it).
const SIGNED_TTL_SECONDS = 60 * 60; // 1 hour
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** Resolve a stored media_url into a displayable url. For private-bucket media
 *  this returns a signed url (cached until ~1 min before expiry); everything else
 *  (data URIs, stickers, external/local urls) is returned unchanged. On any error
 *  it falls back to the original url rather than throwing, so callers can always
 *  render *something* and surface a retry. */
export async function signedMediaUrl(
  client: SupabaseClient,
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return url ?? null;
  const path = mediaPathFromUrl(url);
  if (!path) return url; // not private media — pass through unchanged

  const now = Date.now();
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > now + 60_000) return cached.url;

  const { data, error } = await client.storage
    .from('media')
    .createSignedUrl(path, SIGNED_TTL_SECONDS);

  if (error) {
    console.warn('[media] signedUrl error for path:', path, 'error:', error.message);
    return null; // Return null so SignedImage shows retry button instead of 403
  }

  if (!data?.signedUrl) {
    console.warn('[media] signedUrl returned no URL for path:', path);
    return null;
  }

  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: now + SIGNED_TTL_SECONDS * 1000 });
  return data.signedUrl;
}

/** Evict a cached signed URL so the next signedMediaUrl() call re-signs. Called
 *  on user-initiated retry so a transient signing error doesn't stick around
 *  for an hour. No-op for non-media urls. */
export function invalidateSignedMediaUrl(url: string | null | undefined): void {
  const path = mediaPathFromUrl(url);
  if (path) signedUrlCache.delete(path);
}

// Upload status media (image / video / audio) to the private `status` bucket,
// under <userId>/<ts>.<ext> (matches the "status owner write" storage policy).
// Both web and mobile use this so the bucket/path/url logic lives in one place.
// Retry = simply call again (a fresh timestamped path is used each time).
export async function uploadStatusMedia(
  client: SupabaseClient,
  userId: UUID,
  file: File | Blob | ArrayBuffer,
  ext: string,
  contentType?: string,
): Promise<{ url: string | null; error: Error | null }> {
  const path = `${userId}/${Date.now()}.${ext.replace(/^\./, '')}`;
  const { error } = await client.storage
    .from('status')
    .upload(path, file as Blob, contentType ? { contentType } : undefined);
  if (error) return { url: null, error };
  const { data } = client.storage.from('status').getPublicUrl(path);
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
