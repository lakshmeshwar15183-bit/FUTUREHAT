// Lumixo web — durable message history cache (IndexedDB).
// Cache-first chat open: paint from here immediately, then background-sync.
// Mirrors mobile localCache message APIs so offline reopen works on web too.
//
// Design:
//  • One object store keyed by conversationId → { messages, updatedAt }
//  • Cap MSG_CACHE_LIMIT per thread (shared/localFirst)
//  • Preserve pending/failed local-only rows across network rewrites
//  • Best-effort: corrupt/missing → empty array; never throws into UI

import type { Message } from '@shared/types';
import {
  MSG_CACHE_LIMIT,
  isLocalOnlyMessage,
  mergeMessagesById,
  latestSyncedCreatedAt,
} from '@shared/localFirst';

const DB_NAME = 'lumixo_msg_cache_v1';
const STORE = 'threads';
const DB_VERSION = 1;
const DRAFT_PREFIX = 'fh:web:draft:';

type ThreadRow = {
  conversationId: string;
  messages: Message[];
  updatedAt: number;
};

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
        db.createObjectStore(STORE, { keyPath: 'conversationId' });
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      Promise.resolve(fn(store))
        .then((v) => {
          tx.oncomplete = () => resolve(v);
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'));
        })
        .catch(reject);
    });
  } finally {
    db.close();
  }
}

function idbGet(store: IDBObjectStore, key: string): Promise<ThreadRow | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as ThreadRow | undefined);
    req.onerror = () => reject(req.error ?? new Error('idb get failed'));
  });
}

function idbPut(store: IDBObjectStore, row: ThreadRow): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.put(row);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('idb put failed'));
  });
}

// Serialize RMW per conversation (realtime + send + full rewrite races).
const chains = new Map<string, Promise<unknown>>();
function withLock<T>(convId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(convId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(
    convId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function trimChrono(messages: Message[]): Message[] {
  return messages
    .slice()
    .sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    )
    .slice(-MSG_CACHE_LIMIT);
}

export async function getCachedMessages(convId: string): Promise<Message[]> {
  try {
    const row = await withStore('readonly', (store) => idbGet(store, convId));
    const list = row?.messages;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Authoritative network window rewrite; keeps local-only pending/failed. */
export async function cacheMessages(convId: string, messages: Message[]): Promise<void> {
  return withLock(convId, async () => {
    try {
      const existing = await getCachedMessages(convId);
      const networkIds = new Set(messages.map((m) => m.id));
      const localOnly = existing.filter((m) => !networkIds.has(m.id) && isLocalOnlyMessage(m));
      const merged = trimChrono(mergeMessagesById(messages, localOnly));
      await withStore('readwrite', (store) =>
        idbPut(store, { conversationId: convId, messages: merged, updatedAt: Date.now() }),
      );
    } catch {
      /* quota / private mode — ignore */
    }
  });
}

/** Upsert one message (realtime / optimistic send). */
export async function upsertCachedMessage(convId: string, message: Message): Promise<void> {
  return withLock(convId, async () => {
    try {
      const cur = await getCachedMessages(convId);
      const idx = cur.findIndex((m) => m.id === message.id);
      if (idx >= 0) cur[idx] = message;
      else cur.push(message);
      const trimmed = trimChrono(cur);
      await withStore('readwrite', (store) =>
        idbPut(store, { conversationId: convId, messages: trimmed, updatedAt: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  });
}

/** Remove hard-deleted / unsent messages from cache. */
export async function removeCachedMessages(convId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const drop = new Set(messageIds);
  return withLock(convId, async () => {
    try {
      const cur = await getCachedMessages(convId);
      const next = cur.filter((m) => !drop.has(m.id));
      if (next.length === cur.length) return;
      await withStore('readwrite', (store) =>
        idbPut(store, { conversationId: convId, messages: next, updatedAt: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  });
}

/** Delta merge: upsert network rows without dropping older local history. */
export async function mergeCachedDelta(convId: string, delta: Message[]): Promise<Message[]> {
  return withLock(convId, async () => {
    try {
      const cur = await getCachedMessages(convId);
      const map = new Map<string, Message>();
      for (const m of cur) map.set(m.id, m);
      for (const m of delta) map.set(m.id, m);
      const merged = trimChrono([...map.values()]);
      await withStore('readwrite', (store) =>
        idbPut(store, { conversationId: convId, messages: merged, updatedAt: Date.now() }),
      );
      return merged;
    } catch {
      return delta;
    }
  });
}

/** Watermark for incremental background sync. */
export async function getMessageWatermark(convId: string): Promise<string | null> {
  const msgs = await getCachedMessages(convId);
  return latestSyncedCreatedAt(msgs);
}

// ── Drafts (localStorage — small, sync) ─────────────────────────────────────

export function getDraft(convId: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + convId) ?? '';
  } catch {
    return '';
  }
}

export function setDraft(convId: string, text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + convId, text);
    else localStorage.removeItem(DRAFT_PREFIX + convId);
  } catch {
    /* ignore */
  }
}
