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
import { sendMessage } from './shared';
import {
  getOutbox,
  removeFromOutbox,
  updateOutboxItem,
  upsertCachedMessage,
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
    if (cameOnline) flushOutbox();
  });
  // Attempt an initial flush shortly after launch (covers messages queued in a
  // previous session that never sent).
  flushOutbox();
  return () => {
    unsub();
    started = false;
  };
}
