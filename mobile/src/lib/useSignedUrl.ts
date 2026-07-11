// Lumixo mobile — resolve a stored media_url into a displayable uri.
// Offline-first: permanent disk cache → signed network URL → download for next time.
//
// The `media` bucket is PRIVATE, so a public url returns 403. Flow:
//   1) file:// / data:// / content:// → pass through (already local)
//   2) permanent media cache hit → return local file:// (NO network)
//   3) sign private path (if needed) and return signed https URL for display
//   4) fire-and-forget download into permanent cache for next open
import { useCallback, useEffect, useState } from 'react';

import { invalidateSignedMediaUrl, mediaPathFromUrl, signedMediaUrl } from './shared';
import { supabase } from './supabase';
import {
  ensureMediaCached,
  getCachedMediaUri,
  mediaCacheKey,
  peekCachedMediaUri,
} from './mediaCache';

export interface SignedUrlState {
  /** Displayable uri (local file:// preferred, else signed https). */
  url: string | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  /** True when serving from permanent local cache (instant offline). */
  fromCache: boolean;
}

export function useSignedUrl(source: string | null | undefined): SignedUrlState {
  // Seed from memory cache so the first paint can be local without waiting.
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

    // Already a local / inline asset.
    if (
      source.startsWith('file://') ||
      source.startsWith('data:') ||
      source.startsWith('content://')
    ) {
      setUrl(source);
      setLoading(false);
      setError(false);
      setFromCache(true);
      return;
    }

    // Instant memory hit.
    const peek = peekCachedMediaUri(source);
    if (peek) {
      setUrl(peek);
      setLoading(false);
      setError(false);
      setFromCache(true);
      // Still revalidate disk async (noop if present).
      void getCachedMediaUri(source);
      return;
    }

    setLoading(true);
    setError(false);

    (async () => {
      // 1) Disk cache
      const local = await getCachedMediaUri(source);
      if (!alive) return;
      if (local) {
        setUrl(local);
        setLoading(false);
        setError(false);
        setFromCache(true);
        return;
      }

      // 2) Network: sign if private media, else use source as-is (avatars, etc.)
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

      // 3) Background: permanently cache so the next open is offline-instant.
      void ensureMediaCached(source).then((cached) => {
        if (!alive || !cached) return;
        // Prefer local path once download completes (same session).
        setUrl(cached);
        setFromCache(true);
      });
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
  }, [source, nonce]);

  return { url, loading, error, retry, fromCache };
}

// Re-export helpers for callers that need them without a hook.
export {
  mediaCacheKey,
  ensureMediaCached,
  getCachedMediaUri,
  prefetchMedia,
  peekCachedMediaUri,
  registerLocalMedia,
  clearMediaCache,
  getMediaCacheStats,
} from './mediaCache';
