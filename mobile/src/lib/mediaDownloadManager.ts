// Lumixo — on-demand media download manager (queue / progress / cancel / retry).
// Full files land in permanent mediaCache only when the user requests them
// (or auto-download policy allows). Cloud originals are never deleted.
import * as FileSystem from 'expo-file-system';

import { mediaPathFromUrl, signedMediaUrl } from './shared';
import { supabase } from './supabase';
import {
  getCachedMediaUri,
  mediaCacheKey,
  peekCachedMediaUri,
  pruneMediaCache,
  registerLocalMedia,
  type MediaCacheEntry,
} from './mediaCache';
import { getMediaStorageSettings } from './mediaPolicy';

export type DownloadStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export interface DownloadJob {
  id: string;
  url: string;
  key: string;
  status: DownloadStatus;
  progress: number; // 0..1
  error?: string;
  localUri?: string;
  bytesWritten?: number;
  totalBytes?: number;
}

type Listener = (jobs: Map<string, DownloadJob>) => void;

const jobs = new Map<string, DownloadJob>();
const listeners = new Set<Listener>();
const resumables = new Map<string, FileSystem.DownloadResumable>();
const waiters = new Map<string, Array<(uri: string | null) => void>>();

let concurrency = 2;
let active = 0;
const queue: string[] = [];

function notify() {
  const snap = new Map(jobs);
  for (const l of listeners) {
    try {
      l(snap);
    } catch {
      /* ignore */
    }
  }
}

function jobId(url: string): string {
  return mediaCacheKey(url) ?? url;
}

export function subscribeDownloads(fn: Listener): () => void {
  listeners.add(fn);
  fn(new Map(jobs));
  return () => {
    listeners.delete(fn);
  };
}

export function getDownloadJob(url: string): DownloadJob | undefined {
  return jobs.get(jobId(url));
}

export function getAllDownloadJobs(): DownloadJob[] {
  return [...jobs.values()];
}

function enqueueRun(id: string) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

function pump() {
  while (active < concurrency && queue.length) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status === 'cancelled' || job.status === 'done') continue;
    if (job.status === 'paused') continue;
    void runJob(id);
  }
}

async function resolveSource(url: string): Promise<string | null> {
  if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('content://')) {
    return url;
  }
  if (mediaPathFromUrl(url)) {
    return signedMediaUrl(supabase, url);
  }
  return url;
}

async function runJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  active += 1;
  job.status = 'running';
  job.progress = Math.max(job.progress, 0.01);
  notify();

  try {
    // Fast path: already on disk
    const hit = await getCachedMediaUri(job.url);
    if (hit) {
      job.status = 'done';
      job.progress = 1;
      job.localUri = hit;
      notify();
      resolveWaiters(id, hit);
      return;
    }

    const source = await resolveSource(job.url);
    if (!source) throw new Error('Could not resolve media URL');

    // Local / data URIs need no download
    if (source.startsWith('file://') || source.startsWith('data:') || source.startsWith('content://')) {
      await registerLocalMedia(job.url, source.startsWith('file://') ? source : source);
      job.localUri = source.startsWith('file://') ? source : (await getCachedMediaUri(job.url)) ?? source;
      job.status = 'done';
      job.progress = 1;
      notify();
      resolveWaiters(id, job.localUri);
      return;
    }

    const dir = `${FileSystem.documentDirectory ?? ''}lumixo-media/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const safe = id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
    const ext = (job.url.split('?')[0].match(/\.([a-zA-Z0-9]{1,5})$/)?.[1] || 'bin').toLowerCase();
    const dest = `${dir}${safe}.${ext}`;

    const resumable = FileSystem.createDownloadResumable(
      source,
      dest,
      {},
      (ev) => {
        const j = jobs.get(id);
        if (!j || j.status === 'cancelled') return;
        if (ev.totalBytesExpectedToWrite > 0) {
          j.progress = ev.totalBytesWritten / ev.totalBytesExpectedToWrite;
          j.bytesWritten = ev.totalBytesWritten;
          j.totalBytes = ev.totalBytesExpectedToWrite;
          notify();
        }
      },
    );
    resumables.set(id, resumable);
    const result = await resumable.downloadAsync();
    resumables.delete(id);
    if (!result?.uri) throw new Error('Download failed');

    await registerLocalMedia(job.url, result.uri);
    job.localUri = result.uri;
    job.status = 'done';
    job.progress = 1;
    notify();
    resolveWaiters(id, job.localUri);
    void pruneMediaCache(getMediaStorageSettings().maxCacheBytes);
  } catch (e) {
    const j = jobs.get(id);
    if (j && j.status !== 'cancelled') {
      j.status = 'error';
      j.error = (e as Error)?.message || 'Download failed';
      notify();
      resolveWaiters(id, null);
    }
  } finally {
    active -= 1;
    pump();
  }
}

function resolveWaiters(id: string, uri: string | null) {
  const list = waiters.get(id);
  if (!list) return;
  waiters.delete(id);
  for (const fn of list) fn(uri);
}

/**
 * Request a full-file download. Dedupes concurrent requests for the same URL.
 * Returns local file:// when done, or null on failure/cancel.
 */
export function requestMediaDownload(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const peek = peekCachedMediaUri(url);
  if (peek) return Promise.resolve(peek);

  const id = jobId(url);
  const existing = jobs.get(id);
  if (existing?.status === 'done' && existing.localUri) {
    return Promise.resolve(existing.localUri);
  }

  return new Promise((resolve) => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);

    if (!existing || existing.status === 'error' || existing.status === 'cancelled') {
      jobs.set(id, {
        id,
        url,
        key: id,
        status: 'queued',
        progress: 0,
      });
      notify();
      enqueueRun(id);
    } else if (existing.status === 'paused') {
      existing.status = 'queued';
      notify();
      enqueueRun(id);
    }
    // running / queued: waiter will be resolved when done
  });
}

export async function pauseDownload(url: string): Promise<void> {
  const id = jobId(url);
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'paused';
  const r = resumables.get(id);
  if (r) {
    try {
      await r.pauseAsync();
    } catch {
      /* ignore */
    }
  }
  notify();
}

export function resumeDownload(url: string): void {
  const id = jobId(url);
  const job = jobs.get(id);
  if (!job || job.status === 'done') return;
  job.status = 'queued';
  job.error = undefined;
  notify();
  enqueueRun(id);
}

export async function cancelDownload(url: string): Promise<void> {
  const id = jobId(url);
  const job = jobs.get(id);
  if (job) {
    job.status = 'cancelled';
    notify();
  }
  const r = resumables.get(id);
  if (r) {
    try {
      await r.pauseAsync();
    } catch {
      /* ignore */
    }
    resumables.delete(id);
  }
  resolveWaiters(id, null);
  // remove from queue
  const qi = queue.indexOf(id);
  if (qi >= 0) queue.splice(qi, 1);
}

export function retryDownload(url: string): Promise<string | null> {
  const id = jobId(url);
  const job = jobs.get(id);
  if (job) {
    job.status = 'queued';
    job.progress = 0;
    job.error = undefined;
    notify();
  }
  return requestMediaDownload(url);
}

// Keep type export for stats consumers
export type { MediaCacheEntry };
