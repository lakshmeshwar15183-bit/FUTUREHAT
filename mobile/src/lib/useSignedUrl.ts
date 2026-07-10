// Lumixo mobile — resolve a stored media_url into a displayable (signed) url.
// The `media` bucket is PRIVATE, so a public url returns 403 and renders as a
// black frame in expo-image with no reliable onError signal. This hook:
//   • passes data-uris / stickers / external urls through unchanged;
//   • signs supabase-media urls via signedMediaUrl (60m TTL, cached);
//   • on a signing failure for a private-media url, returns { url: null, error: true }
//     so callers show a retry button instead of trying to render a doomed public url;
//   • exposes retry() to force a re-sign (bumps a nonce → re-runs the effect).
import { useCallback, useEffect, useState } from 'react';

import { invalidateSignedMediaUrl, mediaPathFromUrl, signedMediaUrl } from './shared';
import { supabase } from './supabase';

export interface SignedUrlState {
  /** The resolved, displayable url (signed for private media), or null while
   *  first resolving OR when signing has definitively failed. */
  url: string | null;
  /** True until the url has been resolved at least once. */
  loading: boolean;
  /** True if resolving failed after a resolve attempt. */
  error: boolean;
  /** Force a re-resolve (busts the signed-url cache for this path). */
  retry: () => void;
}

export function useSignedUrl(source: string | null | undefined): SignedUrlState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    // Force a re-sign — a cached signed url that 403s (e.g. bucket policy just
    // changed, token was invalidated) would otherwise stay stale for an hour.
    invalidateSignedMediaUrl(source);
    setError(false);
    setLoading(true);
    setNonce((n) => n + 1);
  }, [source]);

  useEffect(() => {
    let alive = true;
    if (!source) {
      setUrl(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);

    // Non-media paths (data-uri, sticker, external http, local file:) resolve
    // synchronously — signedMediaUrl would pass them through anyway, but doing
    // it here avoids a needless await and its render flicker.
    const isPrivateMedia = !!mediaPathFromUrl(source);
    if (!isPrivateMedia) {
      setUrl(source);
      setLoading(false);
      return;
    }

    signedMediaUrl(supabase, source)
      .then((resolved) => {
        if (!alive) return;
        // signedMediaUrl falls back to the raw url when signing fails — for a
        // private bucket that url will 403 and render as a black frame. Detect
        // that case by requiring the returned url to be a `/object/sign/` link
        // (or an already-authenticated variant). Otherwise surface error so the
        // caller shows retry instead of trying to render a doomed public url.
        const isSigned = !!resolved && /\/object\/(sign|authenticated)\//.test(resolved);
        if (isSigned) {
          setUrl(resolved);
          setError(false);
        } else {
          setUrl(null);
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUrl(null);
        setLoading(false);
        setError(true);
      });
    return () => {
      alive = false;
    };
  }, [source, nonce]);

  return { url, loading, error, retry };
}
