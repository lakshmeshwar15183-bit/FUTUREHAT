// Lumixo — pure local-first helpers (no I/O).
// Shared by web + mobile so cache merge / watermark / pending flags stay identical.

import type { Message } from './types.js';

/** Cap of message rows retained per conversation in durable client cache. */
export const MSG_CACHE_LIMIT = 800;

/** Newest-window size fetched on open when cache is cold. */
export const MSG_OPEN_LIMIT = 100;

/** How many recent chats to warm into the message cache after first paint. */
export const PRELOAD_RECENT_CHATS = 8;

export type LocalMessageFlags = Message & {
  pending?: boolean;
  failed?: boolean;
};

export function isLocalOnlyMessage(m: Message): boolean {
  const f = m as LocalMessageFlags;
  return !!(f.pending || f.failed);
}

/**
 * Merge by id; `primary` wins on conflict. Chronological ascending.
 */
export function mergeMessagesById(primary: Message[], extra: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of primary) map.set(m.id, m);
  for (const m of extra) {
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
}

/**
 * Apply a network slice onto local history:
 * - Network rows overwrite same ids (server truth for synced messages).
 * - Keep local-only pending/failed rows not present on the network.
 * - Does NOT resurrect deleted rows that vanished from the network slice
 *   when `mode === 'replaceRecent'` (full rewrite of the open window).
 *
 * `mode: 'delta'` — only upsert network rows into local (incremental sync).
 * `mode: 'replaceRecent'` — treat network as authoritative for its window;
 *   drop non-pending local rows older than the network window that aren't
 *   in the network set only if they're inside the network time range…
 *   Simpler approach matching mobile cacheMessages: network list + local-only pending.
 */
export function mergeNetworkMessages(
  local: Message[],
  network: Message[],
  mode: 'delta' | 'replaceRecent' = 'replaceRecent',
): Message[] {
  if (mode === 'delta') {
    // Upsert network into local; preserve all local (including pending).
    const map = new Map<string, Message>();
    for (const m of local) map.set(m.id, m);
    for (const m of network) map.set(m.id, m); // network wins
    return [...map.values()]
      .sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
      )
      .slice(-MSG_CACHE_LIMIT);
  }

  const networkIds = new Set(network.map((m) => m.id));
  const localOnly = local.filter((m) => {
    if (networkIds.has(m.id)) return false;
    return isLocalOnlyMessage(m);
  });
  return mergeMessagesById(network, localOnly).slice(-MSG_CACHE_LIMIT);
}

/** Watermark for delta sync: newest non-pending message created_at. */
export function latestSyncedCreatedAt(messages: Message[]): string | null {
  let latest: string | null = null;
  for (const m of messages) {
    if (isLocalOnlyMessage(m)) continue;
    if (!latest || m.created_at > latest) latest = m.created_at;
  }
  return latest;
}

/** Oldest message created_at for "load older" pagination. */
export function oldestCreatedAt(messages: Message[]): string | null {
  if (!messages.length) return null;
  let oldest = messages[0].created_at;
  for (const m of messages) {
    if (m.created_at < oldest) oldest = m.created_at;
  }
  return oldest;
}

/**
 * Exponential backoff delay (ms) for outbox / action retry attempts.
 * attempt 0 → ~1s, 1 → 2s, … capped at 5 minutes. Jitter ±20%.
 */
export function retryDelayMs(attempts: number, baseMs = 1000, maxMs = 300_000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempts)));
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.floor(jitter);
}
