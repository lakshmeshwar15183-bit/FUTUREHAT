// FUTUREHAT mobile — local-first cache (the "read from local DB, sync later"
// layer that makes chats open instantly and keeps them readable offline, à la
// WhatsApp). Backed by AsyncStorage, which is already linked in this app (it also
// persists the auth session), so this adds no new native module / rebuild risk.
//
// Design: the UI ALWAYS renders from here first (synchronously-cheap reads), then
// a background sync refreshes from Supabase and rewrites the cache. Writes are
// fire-and-forget and never block the UI. All reads/writes are individually
// try/caught so a corrupt or missing entry degrades to "no cache" rather than a
// crash — the network path still works.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationSummary, Message, Profile, MessageType, UUID } from './shared';

const K = {
  convs: (uid: string) => `fh:cache:convs:${uid}`,
  msgs: (convId: string) => `fh:cache:msgs:${convId}`,
  profile: (id: string) => `fh:cache:profile:${id}`,
  draft: (convId: string) => `fh:draft:${convId}`,
  outbox: 'fh:outbox:v1',
  actions: 'fh:actions:v1',
};

// Cap how many messages we retain per conversation so the cache stays bounded
// (AsyncStorage on Android is backed by a size-limited SQLite store).
const MSG_CACHE_LIMIT = 200;

// RFC-4122 v4 id, generated client-side. Not cryptographically strong (fine for
// message ids); lets us render optimistically and dedupe the realtime echo by id.
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort: never let a cache write break the UI */
  }
}

// ── Generic namespaced cache ────────────────────────────────────────────────
// The reusable "read local first, sync later" primitive behind every screen.
// Callers pick a stable key (e.g. `statuses`, `starred:<uid>`, `prefs:<uid>`)
// and get instant reads + fire-and-forget writes. Never throws — a corrupt or
// missing entry degrades to the fallback so the UI always has something to show.
export async function getCache<T>(key: string, fallback: T): Promise<T> {
  return readJSON<T>(`fh:cache:kv:${key}`, fallback);
}
export async function setCache<T>(key: string, value: T): Promise<void> {
  await writeJSON(`fh:cache:kv:${key}`, value);
}

// ── Conversation list ─────────────────────────────────────────────────────────

export async function getCachedConversations(uid: string): Promise<ConversationSummary[]> {
  return readJSON<ConversationSummary[]>(K.convs(uid), []);
}

export async function cacheConversations(uid: string, list: ConversationSummary[]): Promise<void> {
  await writeJSON(K.convs(uid), list);
  // Opportunistically cache the participant profiles too so contact info /
  // headers can resolve names + avatars offline.
  try {
    await Promise.all(
      list.flatMap((c) => c.participants).map((p) => writeJSON(K.profile(p.id), p)),
    );
  } catch {
    /* noop */
  }
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function getCachedMessages(convId: string): Promise<Message[]> {
  return readJSON<Message[]>(K.msgs(convId), []);
}

export async function cacheMessages(convId: string, messages: Message[]): Promise<void> {
  // Keep chronological (oldest→newest) and bounded to the most recent slice.
  const trimmed = messages.slice(-MSG_CACHE_LIMIT);
  await writeJSON(K.msgs(convId), trimmed);
}

/** Merge a single new/updated message into the cached thread (used by realtime
 *  and optimistic sends) without a full refetch. */
export async function upsertCachedMessage(convId: string, message: Message): Promise<void> {
  const cur = await getCachedMessages(convId);
  const idx = cur.findIndex((m) => m.id === message.id);
  if (idx >= 0) cur[idx] = message;
  else cur.push(message);
  await cacheMessages(convId, cur);
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export async function getCachedProfile(id: string): Promise<Profile | null> {
  return readJSON<Profile | null>(K.profile(id), null);
}

export async function cacheProfile(profile: Profile): Promise<void> {
  await writeJSON(K.profile(profile.id), profile);
}

// ── Drafts (persist unsent composer text per chat) ─────────────────────────────

export async function getDraft(convId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(K.draft(convId))) ?? '';
  } catch {
    return '';
  }
}

export async function setDraft(convId: string, text: string): Promise<void> {
  try {
    if (text) await AsyncStorage.setItem(K.draft(convId), text);
    else await AsyncStorage.removeItem(K.draft(convId));
  } catch {
    /* noop */
  }
}

// ── Outbox (messages composed while offline / that failed to send) ─────────────

export interface OutboxItem {
  tempId: string;
  conversationId: UUID;
  senderId: UUID;
  content: string;
  type: MessageType;
  mediaUrl?: string;
  replyTo?: UUID;
  createdAt: string;
  attempts: number;
}

export async function getOutbox(): Promise<OutboxItem[]> {
  return readJSON<OutboxItem[]>(K.outbox, []);
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const cur = await getOutbox();
  cur.push(item);
  await writeJSON(K.outbox, cur);
}

export async function removeFromOutbox(tempId: string): Promise<void> {
  const cur = await getOutbox();
  await writeJSON(K.outbox, cur.filter((i) => i.tempId !== tempId));
}

export async function updateOutboxItem(tempId: string, patch: Partial<OutboxItem>): Promise<void> {
  const cur = await getOutbox();
  const next = cur.map((i) => (i.tempId === tempId ? { ...i, ...patch } : i));
  await writeJSON(K.outbox, next);
}

// ── Action queue (durable outbox for NON-message mutations) ────────────────────
// Every non-message write — pin/mute/archive/hide/star/delete-for-me/mark-read,
// profile edits, settings changes, block — is applied to local state + cache
// INSTANTLY, then recorded here and replayed against Supabase in the background.
// If offline (or a send fails), the descriptor stays queued and auto-runs when
// connectivity returns, so the UI never blocks on the network and no write is
// lost across an app restart. `kind` selects a handler registered in sync.ts.
export interface QueuedAction {
  id: string;
  kind: string;
  payload: any;
  createdAt: string;
  attempts: number;
}

export async function getActionQueue(): Promise<QueuedAction[]> {
  return readJSON<QueuedAction[]>(K.actions, []);
}
export async function enqueueAction(action: QueuedAction): Promise<void> {
  const cur = await getActionQueue();
  cur.push(action);
  await writeJSON(K.actions, cur);
}
export async function removeAction(id: string): Promise<void> {
  const cur = await getActionQueue();
  await writeJSON(K.actions, cur.filter((a) => a.id !== id));
}
export async function updateAction(id: string, patch: Partial<QueuedAction>): Promise<void> {
  const cur = await getActionQueue();
  await writeJSON(K.actions, cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

/** Outbox items for a specific conversation, as optimistic Message rows so the
 *  thread can show queued/pending messages immediately. */
export async function getPendingMessages(convId: string): Promise<Message[]> {
  const box = await getOutbox();
  return box
    .filter((i) => i.conversationId === convId)
    .map((i) => ({
      id: i.tempId,
      conversation_id: i.conversationId,
      sender_id: i.senderId,
      type: i.type,
      content: i.content,
      media_url: i.mediaUrl ?? null,
      reply_to: i.replyTo ?? null,
      is_deleted: false,
      created_at: i.createdAt,
      edited_at: null,
      pending: true,
    }));
}
