// Lumixo web — resolve a stored media_url into a displayable (signed) url.
// The `media` bucket is PRIVATE, so a public url returns 403 and renders as a
// broken image in the browser with no reliable onerror payload. Mirrors the
// mobile hook (mobile/src/lib/useSignedUrl.ts) so both platforms behave the same:
//   • data-uri / stickers / external / blob / file urls pass through unchanged;
//   • supabase-media urls are signed via signedMediaUrl (60m TTL, cached);
//   • on signing failure for a private-media url we return { url: null, error: true }
//     so callers can show a retry affordance instead of rendering a doomed <img>.
//   • retry() forces a re-sign (bumps a nonce → re-runs the effect).
import { useCallback, useEffect, useState } from 'react';

import { invalidateSignedMediaUrl, mediaPathFromUrl, signedMediaUrl } from '@shared/api';
import { supabase } from '../supabase';
import { safeHref } from '../util/safeUrl';
import { ensureMediaCached, getCachedMediaUrl } from './mediaReceiveCache';

export interface SignedUrlState {
  /** Resolved, displayable url (signed for private media). Null while first
   *  resolving OR when signing has definitively failed. */
  url: string | null;
  /** True until the url has been resolved (or errored) at least once. */
  loading: boolean;
  /** True if resolving failed. Callers can show a retry button. */
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

    // XSS defense-in-depth: never pass javascript:/data: HTML payloads to <img>/<a>.
    // data: image/svg stickers are intentional; allow data:image/* only.
    const isDataImage = /^data:image\//i.test(source);
    if (!isDataImage && !mediaPathFromUrl(source)) {
      const safe = safeHref(source);
      if (!safe && !source.startsWith('blob:') && !source.startsWith('file:')) {
        setUrl(null);
        setLoading(false);
        setError(true);
        return;
      }
    }

    // Non-media paths (data-uri stickers, external http, blob:, file:) resolve
    // synchronously — signedMediaUrl would pass them through, but doing it here
    // avoids a needless await and its render flicker.
    const isPrivateMedia = !!mediaPathFromUrl(source);
    if (!isPrivateMedia) {
      if (isDataImage || source.startsWith('blob:') || source.startsWith('file:')) {
        setUrl(source);
      } else {
        setUrl(safeHref(source) ?? null);
      }
      setLoading(false);
      return;
    }

    (async () => {
      // 1) Instant offline / repeat open: permanent IndexedDB media cache.
      try {
        const local = await getCachedMediaUrl(source);
        if (!alive) return;
        if (local) {
          setUrl(local);
          setError(false);
          setLoading(false);
          return;
        }
      } catch {
        /* fall through to sign */
      }

      try {
        const resolved = await signedMediaUrl(supabase, source);
        if (!alive) return;
        // signedMediaUrl falls back to the raw url when signing fails — for a
        // private bucket that url will 403 and render broken. Require a signed
        // form; otherwise surface error so the caller shows retry.
        const isSigned = !!resolved && /\/object\/(sign|authenticated)\//.test(resolved);
        if (isSigned && resolved) {
          setUrl(resolved);
          setError(false);
          setLoading(false);
          // 2) Background: persist bytes so next open / offline is instant.
          void ensureMediaCached(source, resolved).then((localUrl) => {
            if (!alive || !localUrl || localUrl === resolved) return;
            // Prefer blob: once cached (stable offline).
            setUrl(localUrl);
          });
        } else {
          setUrl(null);
          setError(true);
          setLoading(false);
        }
      } catch {
        if (!alive) return;
        setUrl(null);
        setLoading(false);
        setError(true);
      }
    })();
    return () => { alive = false; };
  }, [source, nonce]);

  return { url, loading, error, retry };
}
