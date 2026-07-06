// FUTUREHAT mobile — background sync + offline outbox.
//
// Two jobs:
//  1) Flush the outbox: any message composed while offline (or whose send failed)
//     is retried automatically when connectivity returns, in order.
//  2) Broadcast connectivity so screens can reflect "waiting for network".
//
// The actual optimistic UI (showing the message instantly) lives in the screens;
// this module owns the durable queue + retry so a queued message survives an app
// restart and sends itself the moment the device is back online.
import NetInfo from '@react-native-community/netinfo';

import { supabase } from './supabase';
import {
  sendMessage,
  pinConversation,
  unpinConversation,
  muteConversation,
  unmuteConversation,
  archiveConversation,
  unarchiveConversation,
  lockConversation,
  unlockConversation,
  markConversationRead,
  blockUser,
  unblockUser,
  starMessage,
  unstarMessage,
  hideMessageForMe,
  deleteConversationForMe,
  deleteConversationForEveryone,
  updateMyProfile,
  updatePreferences,
  getPreferences,
  setChatSettings,
  setPrivacy,
  removeRecentContact,
  recordStreakActivity,
} from './shared';
import {
  getOutbox,
  removeFromOutbox,
  updateOutboxItem,
  upsertCachedMessage,
  getActionQueue,
  enqueueAction,
  removeAction,
  updateAction,
  uuidv4,
  type OutboxItem,
} from './localCache';

type OnlineListener = (online: boolean) => void;
type OutboxListener = (item: OutboxItem, sentId: string) => void;

let online = true;
let flushing = false;
const onlineListeners = new Set<OnlineListener>();
const sentListeners = new Set<OutboxListener>();

export function isOnline(): boolean {
  return online;
}

/** Subscribe to connectivity changes. Returns an unsubscribe fn. */
export function onConnectivity(fn: OnlineListener): () => void {
  onlineListeners.add(fn);
  fn(online);
  return () => onlineListeners.delete(fn);
}

/** Subscribe to "an outbox message just sent" so an open thread can swap the
 *  pending row for the confirmed one. Returns an unsubscribe fn. */
export function onOutboxSent(fn: OutboxListener): () => void {
  sentListeners.add(fn);
  return () => sentListeners.delete(fn);
}

/** Try to send everything in the outbox, oldest first. Safe to call repeatedly;
 *  re-entrancy-guarded. Stops early if the network drops mid-flush. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const box = await getOutbox();
    for (const item of box) {
      if (!online) break;
      try {
        const { message, error } = await sendMessage(
          supabase,
          item.conversationId,
          item.content,
          item.type,
          item.mediaUrl,
          item.replyTo,
          item.tempId, // reuse the optimistic id as the real row id
        );
        // A duplicate-key error means a PRIOR attempt already inserted this row
        // (its id === tempId) but we never got to dequeue it — treat as sent so we
        // don't retry forever. Postgres unique-violation is SQLSTATE 23505.
        const dupe = !!error && (
          (error as any).code === '23505' ||
          /duplicate key|already exists/i.test(error.message ?? '')
        );
        if ((message && !error) || dupe) {
          if (message) await upsertCachedMessage(item.conversationId, message);
          await removeFromOutbox(item.tempId);
          sentListeners.forEach((l) => l(item, message?.id ?? item.tempId));
          // Live streak signal (fire-and-forget): the SERVER re-derives whether this
          // actually qualifies from the real message tables — this never sets a
          // score, it only keeps the "waiting on peer / done today" UI fresh. The
          // authoritative +1 is finalised by the daily job regardless of this call.
          recordStreakActivity(supabase, item.conversationId).catch(() => {});
        } else {
          await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
        }
      } catch {
        await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
      }
    }
  } finally {
    flushing = false;
  }
}

// ── Generic action queue runner ───────────────────────────────────────────────
// Handlers turn a queued descriptor back into the shared network call. Each
// returns a Supabase-style { error } (or throws) so the runner can tell a
// transient failure (keep + retry) from success (dequeue). Registered once here
// so screens only ever call queueAction(kind, payload) — never the network
// directly for these mutations.
type ActionResult = { error?: unknown } | void;

// Immutably set `value` at `path` within a plain object, creating intermediate
// objects as needed. Used by the mergeExtra handler so a queued edit targets one
// leaf of user_preferences.extra without carrying (and clobbering) its siblings.
function deepSet(root: any, path: string[], value: unknown): any {
  const base = root && typeof root === 'object' ? { ...root } : {};
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  base[head] = rest.length === 0 ? value : deepSet(base[head], rest, value);
  return base;
}

// Conflict-safe merge into user_preferences.extra. The queued payload holds only
// { path, value } — NOT a full extra snapshot — so two edits made offline to
// different leaves (e.g. extra.notifications and extra.storage) both survive:
// each is replayed against the CURRENT server extra, re-read here at flush time,
// rather than against a stale snapshot captured when the toggle was tapped.
// Scalable: any future extra.<section> setting reuses this one handler.
async function mergeExtra(payload: { path: string[]; value: unknown }): Promise<ActionResult> {
  const prefs: any = await getPreferences(supabase).catch(() => null);
  if (!prefs) return { error: new Error('could not read preferences') }; // keep queued, retry
  const extra = prefs.extra && typeof prefs.extra === 'object' ? prefs.extra : {};
  const nextExtra = deepSet(extra, payload.path, payload.value);
  return updatePreferences(supabase, { extra: nextExtra } as any);
}

const actionHandlers: Record<string, (payload: any) => Promise<ActionResult>> = {
  pin: (p) => pinConversation(supabase, p.conversationId),
  unpin: (p) => unpinConversation(supabase, p.conversationId),
  mute: (p) => muteConversation(supabase, p.conversationId),
  unmute: (p) => unmuteConversation(supabase, p.conversationId),
  archive: (p) => archiveConversation(supabase, p.conversationId),
  unarchive: (p) => unarchiveConversation(supabase, p.conversationId),
  // Chat Lock (0027): device-secured per-chat lock. Only the user's CHOICE to
  // lock syncs here — never a PIN/biometric (those stay on-device).
  lockChat: (p) => lockConversation(supabase, p.conversationId),
  unlockChat: (p) => unlockConversation(supabase, p.conversationId),
  markRead: (p) => markConversationRead(supabase, p.conversationId),
  block: (p) => blockUser(supabase, p.userId),
  unblock: (p) => unblockUser(supabase, p.userId),
  star: (p) => starMessage(supabase, p.messageId),
  unstar: (p) => unstarMessage(supabase, p.messageId),
  hideMessage: (p) => hideMessageForMe(supabase, p.messageId),
  deleteForMe: (p) => deleteConversationForMe(supabase, p.conversationId),
  deleteForEveryone: (p) => deleteConversationForEveryone(supabase, p.conversationId),
  updateProfile: (p) => updateMyProfile(supabase, p.updates),
  updatePreferences: (p) => updatePreferences(supabase, p.updates),
  // Remove one person from the New Chat "recent contacts" history. Removal-only:
  // does not delete messages/conversation, block, or touch the other account.
  removeRecentContact: (p) => removeRecentContact(supabase, p.contactId),
  updateChatSettings: (p) => setChatSettings(supabase, p.patch),
  updatePrivacy: (p) => setPrivacy(supabase, p.patch),
  // Conflict-safe partial write into user_preferences.extra (notifications,
  // storage, and any future extra.<section>). See mergeExtra() above.
  mergeExtra: (p) => mergeExtra(p),
};

// Drop an action after this many failed attempts so a permanently-invalid write
// (e.g. a since-deleted row) can't wedge the queue forever. Generous, so a long
// offline stretch never discards a legitimate action.
const MAX_ACTION_ATTEMPTS = 25;

let flushingActions = false;

/** Replay the action queue oldest-first. A transient failure is left queued and
 *  retried on the next flush; a genuinely stuck item is dropped after
 *  MAX_ACTION_ATTEMPTS. One failing item never blocks the others. */
export async function flushActions(): Promise<void> {
  if (flushingActions) return;
  flushingActions = true;
  try {
    const queue = await getActionQueue();
    for (const action of queue) {
      if (!online) break; // nothing to gain while offline
      const handler = actionHandlers[action.kind];
      if (!handler) { await removeAction(action.id); continue; } // unknown kind: drop
      try {
        const res = await handler(action.payload);
        const err = res && typeof res === 'object' ? (res as any).error : null;
        if (err) {
          const attempts = (action.attempts ?? 0) + 1;
          if (attempts >= MAX_ACTION_ATTEMPTS) await removeAction(action.id);
          else await updateAction(action.id, { attempts });
        } else {
          await removeAction(action.id);
        }
      } catch {
        const attempts = (action.attempts ?? 0) + 1;
        if (attempts >= MAX_ACTION_ATTEMPTS) await removeAction(action.id);
        else await updateAction(action.id, { attempts });
      }
    }
  } finally {
    flushingActions = false;
  }
}

/**
 * Record a mutation and sync it in the background. Screens call this AFTER they
 * have already updated local state + cache, so the UI is instant and the network
 * is pure sync. Runs immediately if online; otherwise the descriptor waits in the
 * durable queue and auto-runs on reconnect. Never rejects.
 */
export async function queueAction(kind: string, payload: unknown): Promise<void> {
  await enqueueAction({ id: uuidv4(), kind, payload, createdAt: new Date().toISOString(), attempts: 0 });
  if (online) flushActions().catch(() => {});
}

let started = false;

/** Wire up the connectivity listener + initial flush. Call once at app start. */
export function startSync(): () => void {
  if (started) return () => {};
  started = true;
  const unsub = NetInfo.addEventListener((state) => {
    const nowOnline = !!state.isConnected && state.isInternetReachable !== false;
    const cameOnline = nowOnline && !online;
    online = nowOnline;
    onlineListeners.forEach((l) => l(online));
    if (cameOnline) { flushOutbox(); flushActions(); }
  });
  // Attempt an initial flush shortly after launch (covers messages + actions
  // queued in a previous session that never synced).
  flushOutbox();
  flushActions();
  return () => {
    unsub();
    started = false;
  };
}
