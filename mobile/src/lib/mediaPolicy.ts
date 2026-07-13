// Lumixo — media download policy (WhatsApp/Telegram-class).
//
// After reinstall / new login: messages + metadata sync immediately.
// Full media files are NOT pulled until the user taps (or explicitly enables
// auto-download on Wi‑Fi / cellular). Cloud copies are never deleted.
//
// Pure + AsyncStorage only — NetInfo lives in mediaNetwork.ts (Jest-safe).
import AsyncStorage from '@react-native-async-storage/async-storage';

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'gif' | 'avatar';

export type MediaQualityPref = 'auto' | 'high' | 'data_saver';

export type NetworkClass = 'wifi' | 'cellular' | 'none' | 'unknown';

/** Per-type auto-download (WhatsApp Storage & Data). Device-local only. */
export interface MediaKindAutoDownload {
  photos: boolean;
  videos: boolean;
  audio: boolean;
  documents: boolean;
  gifs: boolean;
}

/** WhatsApp-style Storage & Data preferences (device-local + optional prefs.extra). */
export interface MediaStorageSettings {
  /** Auto-download photos/media when on Wi‑Fi. Default OFF (no reinstall flood). */
  autoDownloadWifi: boolean;
  /** Auto-download on cellular. Default OFF. */
  autoDownloadCellular: boolean;
  /** Auto-download while roaming. Default OFF. */
  autoDownloadRoaming: boolean;
  /** When true, never auto-download anything — only on explicit tap. Default ON. */
  downloadOnlyWhenTapped: boolean;
  /** Soft cap for permanent media cache (bytes). Default 512 MB. */
  maxCacheBytes: number;
  /** Upload / send quality preference (mirrors chat settings). */
  mediaQuality: MediaQualityPref;
  dataSaverCalls: boolean;
  lowDataMode: boolean;
  /** Which media types may auto-download when network rules allow. */
  kindAuto: MediaKindAutoDownload;
}

export const DEFAULT_KIND_AUTO: MediaKindAutoDownload = {
  photos: true,
  videos: false,
  audio: true,
  documents: false,
  gifs: true,
};

export const DEFAULT_MEDIA_STORAGE: MediaStorageSettings = {
  autoDownloadWifi: false,
  autoDownloadCellular: false,
  autoDownloadRoaming: false,
  downloadOnlyWhenTapped: true,
  maxCacheBytes: 512 * 1024 * 1024,
  mediaQuality: 'auto',
  dataSaverCalls: false,
  lowDataMode: false,
  kindAuto: { ...DEFAULT_KIND_AUTO },
};

const STORAGE_KEY = 'fh:media-storage:v1';

let cached: MediaStorageSettings = { ...DEFAULT_MEDIA_STORAGE };
let hydrated = false;
let hydratePromise: Promise<MediaStorageSettings> | null = null;
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

function mergeSettings(raw: unknown): MediaStorageSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MEDIA_STORAGE };
  const partial = raw as Partial<MediaStorageSettings>;
  return {
    ...DEFAULT_MEDIA_STORAGE,
    ...partial,
    kindAuto: { ...DEFAULT_KIND_AUTO, ...(partial.kindAuto ?? {}) },
  };
}

function kindAllowed(
  kind: MediaKind,
  settings: MediaStorageSettings,
): boolean {
  const k = settings.kindAuto ?? DEFAULT_KIND_AUTO;
  switch (kind) {
    case 'image':
      return k.photos;
    case 'video':
      return k.videos;
    case 'audio':
      return k.audio;
    case 'document':
      return k.documents;
    case 'gif':
      return k.gifs;
    case 'avatar':
      return true;
    default:
      return true;
  }
}

export function getMediaStorageSettings(): MediaStorageSettings {
  return cached;
}

export function subscribeMediaStorage(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function hydrateMediaStorageSettings(): Promise<MediaStorageSettings> {
  if (hydrated) return cached;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) cached = mergeSettings(JSON.parse(raw));
    } catch {
      cached = { ...DEFAULT_MEDIA_STORAGE };
    } finally {
      hydrated = true;
      notify();
    }
    return cached;
  })();
  return hydratePromise;
}

void hydrateMediaStorageSettings();

export async function setMediaStorageSettings(
  patch: Partial<MediaStorageSettings>,
): Promise<MediaStorageSettings> {
  cached = { ...cached, ...patch };
  notify();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* ignore */
  }
  return cached;
}

/** Apply server prefs.extra.storage when present (merge, don't wipe local defaults). */
export function applyServerStorageExtra(extra: Record<string, unknown> | null | undefined) {
  if (!extra || typeof extra !== 'object') return;
  const next = mergeSettings({ ...cached, ...extra });
  const leg = extra as {
    autoDownloadWifiOnly?: boolean;
    dataSaverCalls?: boolean;
    lowDataMode?: boolean;
  };
  if (leg.autoDownloadWifiOnly === true) {
    next.autoDownloadWifi = true;
    next.autoDownloadCellular = false;
  }
  if (typeof leg.dataSaverCalls === 'boolean') next.dataSaverCalls = leg.dataSaverCalls;
  if (typeof leg.lowDataMode === 'boolean') next.lowDataMode = leg.lowDataMode;
  cached = next;
  notify();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
}

/**
 * Should we auto-fetch full media into permanent cache / bubble preview?
 * Default: false (tap only) — prevents reinstall bandwidth/storage storm.
 *
 * Pass `net` from mediaNetwork.getNetworkClass() in app code; tests pass explicitly.
 */
export function shouldAutoDownload(
  kind: MediaKind,
  net: NetworkClass,
  roaming = false,
  settings: MediaStorageSettings = cached,
): boolean {
  if (settings.downloadOnlyWhenTapped) return false;
  if (settings.lowDataMode && kind !== 'avatar') return false;
  if (net === 'none') return false;

  // Avatars are tiny — allow on any live network (not bulk history).
  if (kind === 'avatar') return true;

  if (!kindAllowed(kind, settings)) return false;

  if (net === 'wifi') return settings.autoDownloadWifi;
  if (net === 'cellular') {
    if (roaming && !settings.autoDownloadRoaming) return false;
    return settings.autoDownloadCellular;
  }
  // unknown: only if Wi‑Fi auto is on (conservative)
  return settings.autoDownloadWifi;
}

/** Persist full file after open/play (always allowed when user requested). */
export function shouldPersistOnOpen(): boolean {
  return true;
}

export function formatBytes(b: number): string {
  if (!b || b < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDurationMs(ms?: number | null): string {
  if (!ms || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
