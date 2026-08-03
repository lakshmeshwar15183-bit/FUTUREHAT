// Lumixo web — permanent cache for *received* media (WhatsApp-class).
// Keyed by stable storage path (not signed URL — signs expire).
// On hit: blob: object URL (instant offline display).
// On miss: caller signs → fetches → putBlob → next open is local.
// Thumbnails: same store; full-quality is whatever the signed URL returns.
// Bound by entry count + total size; LRU by last access.

import { mediaPathFromUrl } from '@shared/api';

const DB_NAME = 'lumixo_recv_media_v1';
const STORE = 'media';
const DB_VERSION = 1;
const MAX_ENTRIES = 400;
const MAX_BYTES = 120 * 1024 * 1024; // ~120 MB

type MediaRow = {
  path: string;
  blob: Blob;
  mime: string;
  at: number;
  bytes: number;
};

// Live object URLs for this session (path → blob:)
const objectUrls = new Map<string, string>();
// In-flight fetches
const inflight = new Map<string, Promise<string | null>>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
  });
}

async function idbGet(path: string): Promise<MediaRow | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(path);
      req.onsuccess = () => resolve((req.result as MediaRow) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(row: MediaRow): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(row);
    });
  } finally {
    db.close();
  }
}

async function idbAll(): Promise<MediaRow[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as MediaRow[]) || []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(path: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(path);
    });
  } finally {
    db.close();
  }
}

async function pruneIfNeeded(incomingBytes: number): Promise<void> {
  try {
    const all = await idbAll();
    let total = all.reduce((s, r) => s + (r.bytes || 0), 0) + incomingBytes;
    if (all.length < MAX_ENTRIES && total < MAX_BYTES) return;
    const sorted = all.slice().sort((a, b) => a.at - b.at); // oldest first
    for (const row of sorted) {
      if (all.length - sorted.indexOf(row) <= MAX_ENTRIES * 0.75 && total < MAX_BYTES * 0.85) break;
      await idbDelete(row.path);
      const ou = objectUrls.get(row.path);
      if (ou) {
        try { URL.revokeObjectURL(ou); } catch { /* noop */ }
        objectUrls.delete(row.path);
      }
      total -= row.bytes || 0;
    }
  } catch {
    /* ignore prune failures */
  }
}

/** Resolve stable cache key from media_url (path) or null if not cacheable. */
export function mediaCacheKey(source: string | null | undefined): string | null {
  if (!source) return null;
  return mediaPathFromUrl(source) ?? null;
}

/** Instant hit: blob: URL if we already have bytes (or session object URL). */
export async function getCachedMediaUrl(source: string | null | undefined): Promise<string | null> {
  const path = mediaCacheKey(source);
  if (!path) return null;
  const mem = objectUrls.get(path);
  if (mem) return mem;
  try {
    const row = await idbGet(path);
    if (!row?.blob) return null;
    // Touch LRU
    void idbPut({ ...row, at: Date.now() }).catch(() => {});
    const url = URL.createObjectURL(row.blob);
    objectUrls.set(path, url);
    return url;
  } catch {
    return null;
  }
}

/** Persist a fetched blob under the storage path of `source`. */
export async function putCachedMedia(
  source: string,
  blob: Blob,
): Promise<string | null> {
  const path = mediaCacheKey(source);
  if (!path || !blob || blob.size === 0) return null;
  try {
    await pruneIfNeeded(blob.size);
    const row: MediaRow = {
      path,
      blob,
      mime: blob.type || 'application/octet-stream',
      at: Date.now(),
      bytes: blob.size,
    };
    await idbPut(row);
    const prev = objectUrls.get(path);
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { /* noop */ }
    }
    const url = URL.createObjectURL(blob);
    objectUrls.set(path, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Ensure media is local: cache hit → blob URL; else fetch `signedUrl` and store.
 * Returns display URL (blob: or signed) — never throws.
 */
export async function ensureMediaCached(
  source: string,
  signedUrl: string,
): Promise<string> {
  const path = mediaCacheKey(source);
  if (!path) return signedUrl;

  const hit = await getCachedMediaUrl(source);
  if (hit) return hit;

  const existing = inflight.get(path);
  if (existing) {
    const r = await existing;
    return r || signedUrl;
  }

  const work = (async (): Promise<string | null> => {
    try {
      // Skip huge files (videos) for auto-cache — only images / small media.
      // Callers can still open full quality via signed URL when not cached.
      const res = await fetch(signedUrl, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      // Cap single entry ~25MB (images/voice/docs; skip large videos).
      if (blob.size > 25 * 1024 * 1024) return null;
      return await putCachedMedia(source, blob);
    } catch {
      return null;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, work);
  const cached = await work;
  return cached || signedUrl;
}
