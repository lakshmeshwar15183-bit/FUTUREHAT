// Lumixo mobile — resolve a stored media_url into a displayable uri.
//
// Offline-first for ALREADY-CACHED files. Full permanent download is OPT-IN:
//   • persist: false (default) — never auto-write documentDirectory after reinstall
//   • persist: true — used after user opens / plays / taps Download
//   • autoPersistIfPolicyAllows — background cache only when Storage policy says so
//
// Display can still use a short-lived signed HTTPS URL (expo-image / AV) without
// permanently caching the full blob.
import { useCallback, useEffect, useState } from 'react';

import { invalidateSignedMediaUrl, mediaPathFromUrl, signedMediaUrl } from './shared';
import { supabase } from './supabase';
import {
  ensureMediaCached,
  getCachedMediaUri,
  peekCachedMediaUri,
} from './mediaCache';
import {
  hydrateMediaStorageSettings,
  shouldAutoDownload,
  type MediaKind,
} from './mediaPolicy';
import { getNetworkClass, isRoamingLike } from './mediaNetwork';

export interface SignedUrlOptions {
  /**
   * When true, download into permanent media cache after resolve.
   * Default false — WhatsApp/Telegram on-demand (no reinstall flood).
   */
  persist?: boolean;
  /**
   * If set, call shouldAutoDownload(kind) and persist only when allowed.
   * Ignored when persist is forced true.
   */
  kind?: MediaKind;
}

export interface SignedUrlState {
  /** Displayable uri (local file:// preferred, else signed https). */
  url: string | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  /** True when serving from permanent local cache (instant offline). */
  fromCache: boolean;
}

export function useSignedUrl(
  source: string | null | undefined,
  options: SignedUrlOptions = {},
): SignedUrlState {
  const persist = options.persist === true;
  const kind = options.kind;

  const mem = peekCachedMediaUri(source);
  const [url, setUrl] = useState<string | null>(mem);
  const [loading, setLoading] = useState(!mem && !!source);
  const [error, setError] = useState(false);
  const [fromCache, setFromCache] = useState(!!mem);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    invalidateSignedMediaUrl(source);
    setError(false);
    setLoading(true);
    setFromCache(false);
    setNonce((n) => n + 1);
  }, [source]);

  useEffect(() => {
    let alive = true;
    if (!source) {
      setUrl(null);
      setLoading(false);
      setError(false);
      setFromCache(false);
      return;
    }

    if (
      source.startsWith('file://') ||
      source.startsWith('data:') ||
      source.startsWith('content://') ||
      source.startsWith('lumixo-sticker://')
    ) {
      setUrl(source);
      setLoading(false);
      setError(false);
      setFromCache(true);
      return;
    }

    const peek = peekCachedMediaUri(source);
    if (peek) {
      setUrl(peek);
      setLoading(false);
      setError(false);
      setFromCache(true);
      void getCachedMediaUri(source);
      return;
    }

    setLoading(true);
    setError(false);

    (async () => {
      await hydrateMediaStorageSettings();
      if (!alive) return;

      // 1) Disk cache only (no network if present)
      const local = await getCachedMediaUri(source);
      if (!alive) return;
      if (local) {
        setUrl(local);
        setLoading(false);
        setError(false);
        setFromCache(true);
        return;
      }

      // 2) Sign for display (metadata path) — does NOT permanent-cache by default
      const isPrivate = !!mediaPathFromUrl(source);
      let remote: string | null = source;
      if (isPrivate) {
        remote = await signedMediaUrl(supabase, source);
        if (!alive) return;
        if (!remote || !/\/object\/(sign|authenticated)\//.test(remote)) {
          setUrl(null);
          setLoading(false);
          setError(true);
          setFromCache(false);
          return;
        }
      }

      setUrl(remote);
      setLoading(false);
      setError(false);
      setFromCache(false);

      // 3) Permanent cache only when user/policy allows
      const allowPersist =
        persist ||
        (kind != null && shouldAutoDownload(kind, getNetworkClass(), isRoamingLike()));
      if (allowPersist) {
        void ensureMediaCached(source).then((cached) => {
          if (!alive || !cached) return;
          setUrl(cached);
          setFromCache(true);
        });
      }
    })().catch(() => {
      if (!alive) return;
      setUrl(null);
      setLoading(false);
      setError(true);
      setFromCache(false);
    });

    return () => {
      alive = false;
    };
  }, [source, nonce, persist, kind]);

  return { url, loading, error, retry, fromCache };
}

export {
  mediaCacheKey,
  ensureMediaCached,
  getCachedMediaUri,
  prefetchMedia,
  peekCachedMediaUri,
  registerLocalMedia,
  clearMediaCache,
  getMediaCacheStats,
  pruneMediaCache,
  prefetchMediaIfAllowed,
} from './mediaCache';
