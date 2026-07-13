// Lumixo mobile — permanent offline media cache (WhatsApp-class).
//
// Once a photo/video/audio/doc/avatar is downloaded, it lives on device under
// documentDirectory (NOT the OS temp/cache dir that Android may purge). Opening
// it later never requires a network request unless the remote object changes.
//
// Layers:
//   1) In-memory LRU of resolved local file:// URIs (instant sync reads)
//   2) AsyncStorage index: cacheKey → { localUri, at, size }
//   3) Files on disk under documentDirectory/lumixo-media/
//
// Network path: sign private-bucket URL → download → write index → memory.
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { mediaPathFromUrl, signedMediaUrl } from './shared';
import { supabase } from './supabase';

const DIR = `${FileSystem.documentDirectory ?? ''}lumixo-media/`;
const INDEX_KEY = 'fh:media-index:v2';
const MEM_MAX = 200;

export type MediaCacheEntry = {
  localUri: string;
  at: number;
  size?: number;
  /** Remote etag / path fingerprint if known. */
  key: string;
};

type Index = Record<string, MediaCacheEntry>;

// Hot path: O(1) memory lookups for already-opened media.
const mem = new Map<string, string>();
const memOrder: string[] = [];
let indexCache: Index | null = null;
let indexLoad: Promise<Index> | null = null;
let dirReady: Promise<void> | null = null;
const inflight = new Map<string, Promise<string | null>>();

function touchMem(key: string, uri: string) {
  if (mem.has(key)) {
    const i = memOrder.indexOf(key);
    if (i >= 0) memOrder.splice(i, 1);
  }
  mem.set(key, uri);
  memOrder.push(key);
  while (memOrder.length > MEM_MAX) {
    const old = memOrder.shift();
    if (old) mem.delete(old);
  }
}

/** Stable key for a stored media_url (path for private media, stripped url otherwise). */
export function mediaCacheKey(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('content://')) {
    return url;
  }
  const path = mediaPathFromUrl(url);
  if (path) return `media:${path}`;
  // Avatars / status / external: strip query (signed tokens change).
  return `url:${url.split('?')[0]}`;
}

async function ensureDir() {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(DIR);
        if (!info.exists) {
          await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
        }
      } catch {
        /* best-effort */
      }
    })();
  }
  return dirReady;
}

async function loadIndex(): Promise<Index> {
  if (indexCache) return indexCache;
  if (!indexLoad) {
    indexLoad = (async () => {
      try {
        const raw = await AsyncStorage.getItem(INDEX_KEY);
        indexCache = raw ? (JSON.parse(raw) as Index) : {};
      } catch {
        indexCache = {};
      }
      return indexCache!;
    })();
  }
  return indexLoad;
}

// Serialize index RMW so concurrent ensureMediaCached/registerLocalMedia cannot
// last-writer-win and drop entries (orphan files + "missing" offline media).
let indexChain: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexChain.then(fn, fn);
  indexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function saveIndex(idx: Index): Promise<void> {
  return withIndexLock(async () => {
    // Merge into latest index (another writer may have landed mid-download).
    const latest = await loadIndex();
    const merged: Index = { ...latest, ...idx };
    // Prefer newer `at` when both have the same key.
    for (const k of Object.keys(idx)) {
      const a = latest[k];
      const b = idx[k];
      if (a && b && (a.at ?? 0) > (b.at ?? 0)) merged[k] = a;
      else if (b) merged[k] = b;
    }
    indexCache = merged;
    try {
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  });
}

function extFromUrl(url: string, fallback = 'bin'): string {
  const clean = url.split('?')[0];
  const m = clean.match(/\.([a-zA-Z0-9]{1,5})$/);
  return (m?.[1] || fallback).toLowerCase();
}

function fileNameForKey(key: string, url: string): string {
  // Safe filesystem name from key.
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  const ext = extFromUrl(url, key.includes('video') ? 'mp4' : 'jpg');
  return `${safe}.${ext}`;
}

/** Sync memory hit only — use for first paint without await. */
export function peekCachedMediaUri(url: string | null | undefined): string | null {
  const key = mediaCacheKey(url);
  if (!key || !url) return null;
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('content://')) {
    return url;
  }
  return mem.get(key) ?? null;
}

/**
 * Return a local file:// URI if this media is already on disk.
 * Verifies the file still exists (handles manual clears / reinstall leftovers).
 */
export async function getCachedMediaUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('content://')) {
    return url;
  }
  const key = mediaCacheKey(url);
  if (!key) return null;

  const memHit = mem.get(key);
  if (memHit) {
    try {
      const info = await FileSystem.getInfoAsync(memHit);
      if (info.exists) return memHit;
      mem.delete(key);
    } catch {
      /* revalidate below */
    }
  }

  const idx = await loadIndex();
  const entry = idx[key];
  if (!entry?.localUri) return null;
  try {
    const info = await FileSystem.getInfoAsync(entry.localUri);
    if (!info.exists) {
      delete idx[key];
      await saveIndex(idx);
      return null;
    }
    touchMem(key, entry.localUri);
    return entry.localUri;
  } catch {
    return null;
  }
}

/**
 * Ensure media is on disk. Signs private URLs, downloads once, returns file://.
 * Concurrent callers for the same key share one download promise.
 */
export async function ensureMediaCached(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('content://')) {
    return url;
  }
  const key = mediaCacheKey(url);
  if (!key) return null;

  const existing = await getCachedMediaUri(url);
  if (existing) return existing;

  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async (): Promise<string | null> => {
    try {
      await ensureDir();
      // Resolve signed URL for private media; public/avatar/http pass through.
      let source = url;
      if (mediaPathFromUrl(url)) {
        const signed = await signedMediaUrl(supabase, url);
        if (!signed) return null;
        source = signed;
      }

      const dest = `${DIR}${fileNameForKey(key, url)}`;
      // If a partial file exists from a killed download, overwrite.
      const { uri } = await FileSystem.downloadAsync(source, dest);
      let size: number | undefined;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        size = (info as any).size;
      } catch { /* optional */ }

      const entry: MediaCacheEntry = { localUri: uri, at: Date.now(), size, key };
      const idx = await loadIndex();
      idx[key] = entry;
      // Bound index size (~2000 entries) by dropping oldest.
      const keys = Object.keys(idx);
      if (keys.length > 2000) {
        keys
          .sort((a, b) => (idx[a].at ?? 0) - (idx[b].at ?? 0))
          .slice(0, keys.length - 1800)
          .forEach((k) => {
            const u = idx[k]?.localUri;
            delete idx[k];
            if (u) FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {});
          });
      }
      await saveIndex(idx);
      touchMem(key, uri);
      return uri;
    } catch (e) {
      console.warn('[mediaCache] download failed', key, (e as Error)?.message);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, work);
  return work;
}

/**
 * Prefetch a list of media URLs in the background (concurrency limited).
 * Never throws. Ideal for chat open / conversation list hydrate.
 */
export async function prefetchMedia(
  urls: Array<string | null | undefined>,
  concurrency = 3,
): Promise<void> {
  const list = [...new Set(urls.filter((u): u is string => !!u && !u.startsWith('data:')))];
  if (!list.length) return;
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (i < list.length) {
      const u = list[i++];
      try {
        await ensureMediaCached(u);
      } catch {
        /* continue */
      }
    }
  });
  await Promise.all(workers);
}

/** Register an already-local file (e.g. just uploaded / captured) under a remote key. */
export async function registerLocalMedia(
  remoteUrl: string | null | undefined,
  localUri: string,
): Promise<void> {
  const key = mediaCacheKey(remoteUrl);
  if (!key || !localUri) return;
  if (!localUri.startsWith('file://') && !localUri.startsWith('content://')) return;
  try {
    await ensureDir();
    // Copy into our cache dir when possible so the file survives app temp cleanup.
    let dest = localUri;
    if (FileSystem.documentDirectory && !localUri.includes('lumixo-media')) {
      dest = `${DIR}${fileNameForKey(key, remoteUrl || localUri)}`;
      try {
        await FileSystem.copyAsync({ from: localUri, to: dest });
      } catch {
        dest = localUri; // keep original if copy fails
      }
    }
    const idx = await loadIndex();
    idx[key] = { localUri: dest, at: Date.now(), key };
    await saveIndex(idx);
    touchMem(key, dest);
  } catch {
    /* ignore */
  }
}

/** Approx total bytes used by the media cache (for Storage settings). */
export async function getMediaCacheStats(): Promise<{ count: number; bytes: number }> {
  const idx = await loadIndex();
  let bytes = 0;
  let count = 0;
  for (const e of Object.values(idx)) {
    count += 1;
    if (typeof e.size === 'number') bytes += e.size;
    else {
      try {
        const info = await FileSystem.getInfoAsync(e.localUri);
        if ((info as any).size) bytes += (info as any).size;
      } catch { /* skip */ }
    }
  }
  return { count, bytes };
}

/** Clear all cached media files (user-initiated from Storage settings). */
export async function clearMediaCache(): Promise<void> {
  try {
    const idx = await loadIndex();
    await Promise.all(
      Object.values(idx).map((e) =>
        FileSystem.deleteAsync(e.localUri, { idempotent: true }).catch(() => {}),
      ),
    );
  } catch { /* ignore */ }
  mem.clear();
  memOrder.length = 0;
  indexCache = {};
  await AsyncStorage.removeItem(INDEX_KEY).catch(() => {});
  try {
    await FileSystem.deleteAsync(DIR, { idempotent: true });
  } catch { /* ignore */ }
  dirReady = null;
}

/**
 * Drop oldest permanent-cache entries until total size ≤ maxBytes.
 * Never touches cloud / server objects — only local cache files.
 */
export async function pruneMediaCache(maxBytes: number): Promise<{ removed: number; bytes: number }> {
  if (maxBytes <= 0) return { removed: 0, bytes: 0 };
  const idx = await loadIndex();
  const entries = Object.entries(idx).map(([k, e]) => ({ k, e }));
  // Refresh sizes where missing
  for (const { e } of entries) {
    if (typeof e.size === 'number') continue;
    try {
      const info = await FileSystem.getInfoAsync(e.localUri);
      if ((info as { size?: number }).size) e.size = (info as { size: number }).size;
    } catch {
      /* skip */
    }
  }
  let total = entries.reduce((s, { e }) => s + (e.size ?? 0), 0);
  if (total <= maxBytes) return { removed: 0, bytes: total };

  entries.sort((a, b) => (a.e.at ?? 0) - (b.e.at ?? 0)); // oldest first
  let removed = 0;
  for (const { k, e } of entries) {
    if (total <= maxBytes) break;
    try {
      await FileSystem.deleteAsync(e.localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    total -= e.size ?? 0;
    delete idx[k];
    mem.delete(k);
    const mi = memOrder.indexOf(k);
    if (mi >= 0) memOrder.splice(mi, 1);
    removed += 1;
  }
  indexCache = idx;
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch {
    /* ignore */
  }
  return { removed, bytes: Math.max(0, total) };
}

/**
 * Prefetch only when explicitly allowed (auto-download policy).
 * Unlike ensureMediaCached, this is opt-in — never call on full history hydrate.
 */
export async function prefetchMediaIfAllowed(
  urls: Array<string | null | undefined>,
  allowed: boolean,
  concurrency = 2,
): Promise<void> {
  if (!allowed) return;
  return prefetchMedia(urls, concurrency);
}
