// Lumixo mobile — local-first cache (the "read from local DB, sync later"
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
import type { ConversationSummary, Message, Profile, MessageType, UUID, RecentContact } from './shared';
import {
  mergeProfileIdentity,
  nicknameStorageKey,
  normalizeNickname,
  setNicknameInMap,
  type NicknameMap,
} from './shared';

const K = {
  convs: (uid: string) => `fh:cache:convs:${uid}`,
  msgs: (convId: string) => `fh:cache:msgs:${convId}`,
  profile: (id: string) => `fh:cache:profile:${id}`,
  recent: (uid: string) => `fh:cache:recent:${uid}`,
  draft: (convId: string) => `fh:draft:${convId}`,
  outbox: 'fh:outbox:v1',
  actions: 'fh:actions:v1',
};

// Cap how many messages we retain per conversation so the cache stays bounded
// (AsyncStorage on Android is backed by a size-limited SQLite store).
// Raised for WhatsApp-class offline history (recent slice still sufficient for
// near-instant open; older history loads from network on scroll).
/** Exported for tests — keep in sync with offline-test suite. */
export const MSG_CACHE_LIMIT = 800;

// RFC-4122 v4 id from CSPRNG when available (message PKs via outbox — collisions
// are catastrophic for that row). Falls back to Math.random only if crypto is missing.
export function uuidv4(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array; randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch { /* fall through */ }
  }
  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
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

// Serialize per-conversation message cache RMW so concurrent realtime + send +
// full rewrite cannot drop optimistic or historical rows (last-writer-wins race).
const msgCacheChains = new Map<string, Promise<unknown>>();
function withMsgCacheLock<T>(convId: string, fn: () => Promise<T>): Promise<T> {
  const prev = msgCacheChains.get(convId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  msgCacheChains.set(
    convId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function cacheMessages(convId: string, messages: Message[]): Promise<void> {
  return withMsgCacheLock(convId, async () => {
    // Authoritative network slice wins, but keep local-only optimistic rows
    // (pending/failed outbox) that are not yet on the server — so a concurrent
    // full rewrite cannot erase in-flight sends. Do NOT keep all prior cache
    // rows (that would resurrect deletes).
    const existing = await getCachedMessages(convId);
    const networkIds = new Set(messages.map((m) => m.id));
    const localOnly = existing.filter((m) => {
      if (networkIds.has(m.id)) return false;
      const flags = m as Message & { pending?: boolean; failed?: boolean };
      return !!(flags.pending || flags.failed);
    });
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    for (const m of localOnly) map.set(m.id, m);
    const merged = [...map.values()].sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    );
    const trimmed = merged.slice(-MSG_CACHE_LIMIT);
    await writeJSON(K.msgs(convId), trimmed);
  });
}

/** Merge a single new/updated message into the cached thread (used by realtime
 *  and optimistic sends) without a full refetch. */
export async function upsertCachedMessage(convId: string, message: Message): Promise<void> {
  return withMsgCacheLock(convId, async () => {
    const cur = await getCachedMessages(convId);
    const idx = cur.findIndex((m) => m.id === message.id);
    if (idx >= 0) cur[idx] = message;
    else cur.push(message);
    // Direct write inside lock (avoid nested withMsgCacheLock deadlock).
    const trimmed = cur
      .slice()
      .sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
      )
      .slice(-MSG_CACHE_LIMIT);
    await writeJSON(K.msgs(convId), trimmed);
  });
}

/** Remove hard-deleted messages from the local thread cache (Telegram unsend). */
export async function removeCachedMessages(convId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const drop = new Set(messageIds);
  return withMsgCacheLock(convId, async () => {
    const cur = await getCachedMessages(convId);
    const next = cur.filter((m) => !drop.has(m.id));
    if (next.length === cur.length) return;
    await writeJSON(K.msgs(convId), next);
  });
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export async function getCachedProfile(id: string): Promise<Profile | null> {
  return readJSON<Profile | null>(K.profile(id), null);
}

/**
 * Persist a profile without wiping stronger fields with null/empty network data.
 * Always merges with any prior cache entry.
 */
export async function cacheProfile(profile: Profile): Promise<void> {
  const prev = await getCachedProfile(profile.id);
  const merged = mergeProfileIdentity(prev, profile) ?? profile;
  await writeJSON(K.profile(merged.id), merged as Profile);
}

/** Batch-cache participants from a conversation list (offline identity). */
export async function cacheProfiles(profiles: Profile[]): Promise<void> {
  await Promise.all(profiles.map((p) => cacheProfile(p)));
}

// ── Nicknames (local-only, Instagram-class) ───────────────────────────────────

export async function getNicknames(myUserId: string): Promise<NicknameMap> {
  if (!myUserId) return {};
  return readJSON<NicknameMap>(nicknameStorageKey(myUserId), {});
}

export async function setNickname(
  myUserId: string,
  peerUserId: string,
  nickname: string | null,
): Promise<NicknameMap> {
  const prev = await getNicknames(myUserId);
  const next = setNicknameInMap(prev, peerUserId, nickname);
  await writeJSON(nicknameStorageKey(myUserId), next);
  return next;
}

export async function getNickname(myUserId: string, peerUserId: string): Promise<string | null> {
  const map = await getNicknames(myUserId);
  return normalizeNickname(map[peerUserId] ?? null);
}

// ── Recent contacts (persistent "previously chatted users" for New Chat) ───────
// Independent of the conversations cache, so a deleted chat never removes the
// person here. Read-first: New Chat renders this cached list instantly, then a
// background listRecentContacts() refresh rewrites it. Removals update this cache
// immediately and are synced via the durable action queue ('removeRecentContact').

export async function getCachedRecentContacts(uid: string): Promise<RecentContact[]> {
  return readJSON<RecentContact[]>(K.recent(uid), []);
}

export async function cacheRecentContacts(uid: string, list: RecentContact[]): Promise<void> {
  await writeJSON(K.recent(uid), list);
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
  /** Offline media queue (0030): a local file:// URI to UPLOAD on flush before the
   *  message row is inserted. When set, flushOutbox uploads it and uses the returned
   *  remote URL as media_url. Lets photos/videos survive an app kill mid-send. */
  localUri?: string;
  fileName?: string;
  mediaMeta?: Record<string, unknown>;
}

export async function getOutbox(): Promise<OutboxItem[]> {
  return readJSON<OutboxItem[]>(K.outbox, []);
}

// Serialize outbox RMW so concurrent enqueue/remove/update cannot drop rows.
let outboxChain: Promise<unknown> = Promise.resolve();
function withOutboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = outboxChain.then(fn, fn);
  outboxChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    cur.push(item);
    await writeJSON(K.outbox, cur);
  });
}

export async function removeFromOutbox(tempId: string): Promise<void> {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    await writeJSON(K.outbox, cur.filter((i) => i.tempId !== tempId));
  });
}

export async function updateOutboxItem(tempId: string, patch: Partial<OutboxItem>): Promise<void> {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    const next = cur.map((i) => (i.tempId === tempId ? { ...i, ...patch } : i));
    await writeJSON(K.outbox, next);
  });
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

// Serialize action-queue RMW (same race as outbox under rapid pin/mute/archive).
let actionChain: Promise<unknown> = Promise.resolve();
function withActionLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = actionChain.then(fn, fn);
  actionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function enqueueAction(action: QueuedAction): Promise<void> {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    cur.push(action);
    await writeJSON(K.actions, cur);
  });
}
export async function removeAction(id: string): Promise<void> {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    await writeJSON(K.actions, cur.filter((a) => a.id !== id));
  });
}
export async function updateAction(id: string, patch: Partial<QueuedAction>): Promise<void> {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    await writeJSON(K.actions, cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  });
}

// ── Reconciliation with in-flight optimistic actions ───────────────────────────
// A background server refetch (e.g. getArchivedIds / getLockedIds) returns the
// server's truth, which does NOT yet include a change the user made a moment ago
// whose queued write is still in flight. Folding the queue's pending conversation
// mutations back on top of that server list stops the stale snapshot from
// clobbering the optimistic change — the exact bug behind "archived chat pops
// back into the list" and "chat lock toggle flips back to Off after a refresh".
//
// `addKinds` push a conversation id INTO the effect set (e.g. 'archive','lockChat');
// `removeKinds` take it OUT (e.g. 'unarchive','unlockChat'). The queue is ordered
// oldest→newest and processed in order, so the latest queued action wins (e.g.
// archive-then-unarchive nets to "removed"). Never throws.
export async function pendingConversationEffects(
  addKinds: string[],
  removeKinds: string[],
): Promise<{ adds: Set<string>; removes: Set<string> }> {
  const adds = new Set<string>();
  const removes = new Set<string>();
  try {
    const queue = await getActionQueue();
    for (const a of queue) {
      const cid = a?.payload?.conversationId;
      if (!cid) continue;
      if (addKinds.includes(a.kind)) { adds.add(cid); removes.delete(cid); }
      else if (removeKinds.includes(a.kind)) { removes.add(cid); adds.delete(cid); }
    }
  } catch {
    /* queue unreadable → treat as no pending effects */
  }
  return { adds, removes };
}

// Union two effect snapshots taken around a server read. The server read and the
// queue check are two separate awaits; a queued action can succeed and leave the
// queue in the gap between them, which would drop its effect and let the (possibly
// pre-write) server snapshot revert the user's just-made change — the "toggle
// flips back to Off after a refresh" / "archived chat pops back" race. Capturing
// the queue BOTH before and after the read and merging keeps any effect that was
// pending at either instant. The later snapshot (`b`) wins per id (it reflects the
// most recent net intent, e.g. lock-then-unlock nets to a remove). Never throws.
export function mergeEffects(
  a: { adds: Set<string>; removes: Set<string> },
  b: { adds: Set<string>; removes: Set<string> },
): { adds: Set<string>; removes: Set<string> } {
  const adds = new Set(a.adds);
  const removes = new Set(a.removes);
  b.adds.forEach((id) => { adds.add(id); removes.delete(id); });
  b.removes.forEach((id) => { removes.add(id); adds.delete(id); });
  return { adds, removes };
}

/** Apply pending {adds, removes} on top of a server-authoritative id list, so
 *  reconciliation preserves not-yet-synced optimistic changes. Pure/allocating. */
export function reconcileIds(
  serverIds: Iterable<string>,
  eff: { adds: Set<string>; removes: Set<string> },
): Set<string> {
  const set = new Set(serverIds);
  eff.adds.forEach((id) => set.add(id));
  eff.removes.forEach((id) => set.delete(id));
  return set;
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
      // Show the local file while it's still uploading (localUri), else the remote url.
      media_url: i.mediaUrl ?? i.localUri ?? null,
      reply_to: i.replyTo ?? null,
      is_deleted: false,
      created_at: i.createdAt,
      edited_at: null,
      pending: true,
      media_meta: (i.mediaMeta ?? null) as Message['media_meta'],
    }));
}
