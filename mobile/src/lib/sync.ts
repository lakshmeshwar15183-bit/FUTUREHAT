// Lumixo mobile — background sync + offline outbox.
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
import { uploadMediaFromUri } from './media';
import { registerLocalMedia } from './mediaCache';
import {
  sendMessage,
  editMessage,
  sendPush,
  pinConversation,
  unpinConversation,
  favoriteConversation,
  unfavoriteConversation,
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
type DeadLetterListener = (item: OutboxItem, reason: 'max_attempts') => void;

let online = true;
let flushing = false;
/** If flushOutbox is requested while a flush is in progress, re-run after. */
let outboxNeedsReflush = false;
const onlineListeners = new Set<OnlineListener>();
const sentListeners = new Set<OutboxListener>();
const deadLetterListeners = new Set<DeadLetterListener>();

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

/** Fired when a message is permanently dropped after MAX_OUTBOX_ATTEMPTS so
 *  screens can surface "failed to send" instead of silent loss. */
export function onOutboxDeadLetter(fn: DeadLetterListener): () => void {
  deadLetterListeners.add(fn);
  return () => deadLetterListeners.delete(fn);
}

/** Drop permanently-failed sends so they cannot burn battery forever. */
const MAX_OUTBOX_ATTEMPTS = 30;

/** Try to send everything in the outbox, oldest first. Safe to call repeatedly;
 *  re-entrancy-guarded with re-flush if enqueue races mid-flush. Stops early if
 *  the network drops mid-flush. */
export async function flushOutbox(): Promise<void> {
  if (flushing) {
    // Critical: without this, messages enqueued (or connectivity recovery) during
    // an in-flight flush never get another pass until the next NetInfo event.
    outboxNeedsReflush = true;
    return;
  }
  flushing = true;
  outboxNeedsReflush = false;
  try {
    do {
      outboxNeedsReflush = false;
      const box = await getOutbox();
      for (const item of box) {
        if (!online) break;
        // Dead-letter: stop retrying poison pills (deleted conversation, etc.).
        if ((item.attempts ?? 0) >= MAX_OUTBOX_ATTEMPTS) {
          // Persist failed state in message cache so kill/reopen does not show
          // eternal "sending" or lose the row entirely.
          try {
            const failedMsg = {
              id: item.tempId,
              conversation_id: item.conversationId,
              sender_id: item.senderId,
              type: item.type,
              content: item.content,
              media_url: item.mediaUrl ?? null,
              reply_to: item.replyTo ?? null,
              created_at: item.createdAt ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
              is_deleted: false,
              edited_at: null,
              media_meta: item.mediaMeta ?? null,
              pending: false,
              failed: true,
            } as any;
            await upsertCachedMessage(item.conversationId, failedMsg);
          } catch { /* cache best-effort */ }
          await removeFromOutbox(item.tempId);
          deadLetterListeners.forEach((l) => {
            try { l(item, 'max_attempts'); } catch { /* listener must not break flush */ }
          });
          continue;
        }
        try {
          // Offline media (0030): if this item still holds a LOCAL file:// URI, upload
          // it now (on reconnect) and swap in the remote URL before inserting the row.
          // On upload failure we bump attempts and keep it queued for the next flush.
          let mediaUrl = item.mediaUrl;
          if (item.localUri && !mediaUrl) {
            const { url, error: upErr } = await uploadMediaFromUri(
              item.conversationId, item.localUri, item.fileName ?? `media_${item.tempId}`,
            );
            if (upErr || !url) {
              await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
              continue;
            }
            mediaUrl = url;
            // Keep local file mapped to remote URL so open never re-downloads.
            if (item.localUri) void registerLocalMedia(url, item.localUri);
            await updateOutboxItem(item.tempId, { mediaUrl: url, localUri: undefined });
          }
          const { message, error } = await sendMessage(
            supabase,
            item.conversationId,
            item.content,
            item.type,
            mediaUrl,
            item.replyTo,
            item.tempId, // reuse the optimistic id as the real row id
            item.mediaMeta as import('./shared').MediaMeta | undefined,
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
            // Push notify after offline flush. messageId enables Edge Function dedupe
            // against the DB outbox trigger (one FCM delivery, not two).
            try {
              const mid = message?.id ?? item.tempId;
              const preview =
                item.type === 'text'
                  ? (item.content || 'Message').slice(0, 180)
                  : item.type === 'image'
                    ? ((item.mediaMeta as { sticker?: boolean; emoji?: string } | undefined)?.sticker
                      ? `${(item.mediaMeta as { emoji?: string }).emoji || '🎀'} Sticker`
                      : (/\.gif(\?|#|$)/i.test(item.mediaUrl ?? item.localUri ?? '') ? '🎞️ GIF' : '📷 Photo'))
                    : item.type === 'video'
                      ? '🎥 Video'
                      : item.type === 'audio'
                        ? '🎤 Voice message'
                        : item.type === 'file'
                          ? (item.content?.trim() ? `📄 ${item.content}` : '📄 Document')
                          : 'New message';
              // Title is reconstructed server-side from profiles; body + messageId
              // matter for preview and dedupe. kind defaults to message — Edge
              // Function upgrades channel from conversation type when needed.
              void sendPush(supabase, {
                conversationId: item.conversationId,
                kind: 'message',
                title: '', // empty → Edge uses sender display name (not "New message")
                body: preview,
                data: {
                  messageId: mid,
                  messageType: item.type,
                  type: 'message',
                  senderId: item.senderId,
                },
              });
            } catch { /* ignore */ }
          } else {
            await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
          }
        } catch {
          await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
        }
      }
      // Loop if another flush was requested while we were working (new enqueue, etc.).
    } while (outboxNeedsReflush && online);
  } finally {
    flushing = false;
    // Last-chance re-entry if a request landed between loop exit and flag clear.
    if (outboxNeedsReflush && online) {
      outboxNeedsReflush = false;
      void flushOutbox();
    }
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
  favorite: (p) => favoriteConversation(supabase, p.conversationId),
  unfavorite: (p) => unfavoriteConversation(supabase, p.conversationId),
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
  // Offline-safe message edit (payload: { messageId, content }).
  editMessage: (p) => editMessage(supabase, p.messageId, p.content),
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
let actionsNeedReflush = false;

/** Replay the action queue oldest-first. A transient failure is left queued and
 *  retried on the next flush; a genuinely stuck item is dropped after
 *  MAX_ACTION_ATTEMPTS. One failing item never blocks the others. Re-flushes if
 *  queueAction raced while a flush was already running. */
export async function flushActions(): Promise<void> {
  if (flushingActions) {
    actionsNeedReflush = true;
    return;
  }
  flushingActions = true;
  actionsNeedReflush = false;
  try {
    do {
      actionsNeedReflush = false;
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
    } while (actionsNeedReflush && online);
  } finally {
    flushingActions = false;
    if (actionsNeedReflush && online) {
      actionsNeedReflush = false;
      void flushActions();
    }
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
