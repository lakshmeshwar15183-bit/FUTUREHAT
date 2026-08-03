// Lumixo web — IndexedDB store for offline media blobs (outbox attachments).
// localStorage cannot hold multi-MB files; blobs live here until upload succeeds.

const DB_NAME = 'lumixo_media_blobs_v1';
const STORE = 'blobs';
const DB_VERSION = 1;

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
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
  });
}

export async function putMediaBlob(
  id: string,
  blob: Blob,
  meta?: { fileName?: string; mime?: string },
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb write failed'));
    tx.objectStore(STORE).put({
      id,
      blob,
      fileName: meta?.fileName ?? 'file',
      mime: meta?.mime ?? blob.type ?? 'application/octet-stream',
      at: Date.now(),
    });
  });
  db.close();
}

export async function getMediaBlob(
  id: string,
): Promise<{ blob: Blob; fileName: string; mime: string } | null> {
  const db = await openDb();
  const row = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error ?? new Error('idb read failed'));
  });
  db.close();
  if (!row?.blob) return null;
  return { blob: row.blob as Blob, fileName: row.fileName as string, mime: row.mime as string };
}

export async function deleteMediaBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'));
    tx.objectStore(STORE).delete(id);
  });
  db.close();
}

/** Object URL for preview; caller must revoke. */
export async function blobObjectUrl(id: string): Promise<string | null> {
  const row = await getMediaBlob(id);
  if (!row) return null;
  return URL.createObjectURL(row.blob);
}
