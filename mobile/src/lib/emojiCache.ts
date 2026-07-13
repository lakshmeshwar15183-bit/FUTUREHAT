// Lumixo — warm emoji state so the picker never cold-starts blank/slow.
// Recents + last category load once at module init and stay in memory.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { RECENT_EMOJI_KEY, RECENT_EMOJI_MAX } from './emojiData';

export const LAST_EMOJI_CAT_KEY = 'fh:emoji:lastCat:v1';

let recent: string[] = [];
let lastCategoryId = 'smileys';
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_EMOJI_MAX);
  } catch {
    return [];
  }
}

/** Start background hydrate (idempotent). Safe to call from App / Chat mount. */
export function preloadEmojiCache(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const [rawRecent, rawCat] = await Promise.all([
        AsyncStorage.getItem(RECENT_EMOJI_KEY),
        AsyncStorage.getItem(LAST_EMOJI_CAT_KEY),
      ]);
      recent = parseRecent(rawRecent);
      if (rawCat && typeof rawCat === 'string' && rawCat.length > 0) {
        lastCategoryId = rawCat;
      }
    } catch {
      /* offline / storage fail — keep defaults */
    } finally {
      hydrated = true;
      notify();
    }
  })();
  return hydratePromise;
}

// Kick off as soon as the module is imported (chat / picker cold path).
void preloadEmojiCache();

export function getRecentEmojis(): string[] {
  return recent;
}

export function getLastEmojiCategoryId(): string {
  return lastCategoryId;
}

export function isEmojiCacheReady(): boolean {
  return hydrated;
}

/** Subscribe to cache updates (hydrate + recent pushes). */
export function subscribeEmojiCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pushRecentEmoji(emoji: string): void {
  if (!emoji) return;
  recent = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_EMOJI_MAX);
  notify();
  void AsyncStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(recent)).catch(() => {});
}

export function setLastEmojiCategoryId(id: string): void {
  if (!id || id === lastCategoryId) return;
  lastCategoryId = id;
  notify();
  void AsyncStorage.setItem(LAST_EMOJI_CAT_KEY, id).catch(() => {});
}
