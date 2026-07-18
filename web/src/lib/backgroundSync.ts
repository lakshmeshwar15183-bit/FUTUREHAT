// Lumixo web — silent background sync after first paint.
// Preloads message history for the most recent chats so opening a thread is
// instant (local IndexedDB hit). Never blocks UI; best-effort only.

import { getMessages } from '@shared/api';
import { PRELOAD_RECENT_CHATS, latestSyncedCreatedAt } from '@shared/localFirst';
import type { ConversationSummary } from '@shared/types';
import { supabase } from '../supabase';
import {
  getCachedMessages,
  cacheMessages,
  mergeCachedDelta,
  getMessageWatermark,
} from './messageCache';
import { afterFirstPaint } from './startupCache';

let running = false;
let lastRun = 0;

/**
 * Warm the message cache for the top N conversations.
 * - Cold thread: fetch latest open window and cache.
 * - Warm thread: delta-only (`after` watermark) then merge.
 */
export async function preloadRecentThreads(
  conversations: ConversationSummary[],
  limit = PRELOAD_RECENT_CHATS,
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (running) return;
  // Throttle: at most once per 45s (tab focus / list refresh).
  if (Date.now() - lastRun < 45_000) return;
  running = true;
  lastRun = Date.now();
  try {
    const targets = conversations.slice(0, limit);
    // Serial with small yield so we don't saturate the main thread / network.
    for (const c of targets) {
      const convId = c.conversation.id;
      try {
        const cached = await getCachedMessages(convId);
        if (cached.length === 0) {
          const msgs = await getMessages(supabase, convId, 80);
          if (msgs.length) await cacheMessages(convId, msgs);
        } else {
          const after = (await getMessageWatermark(convId)) ?? latestSyncedCreatedAt(cached);
          if (!after) continue;
          const delta = await getMessages(supabase, convId, { after, limit: 100 });
          if (delta.length) await mergeCachedDelta(convId, delta);
        }
      } catch {
        /* one chat failure must not stop the rest */
      }
      // Yield to event loop between chats.
      await new Promise((r) => setTimeout(r, 40));
    }
  } finally {
    running = false;
  }
}

/** Schedule preload after first paint (call when conversation list is ready). */
export function scheduleThreadPreload(conversations: ConversationSummary[]): void {
  if (!conversations.length) return;
  afterFirstPaint(() => {
    void preloadRecentThreads(conversations);
  });
}
