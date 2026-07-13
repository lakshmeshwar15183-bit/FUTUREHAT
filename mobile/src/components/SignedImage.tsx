// Lumixo mobile — an expo-image that resolves private-bucket media through a
// signed url (fixes the "black screen" bug) and NEVER shows a bare black frame:
// while the url resolves or the bitmap decodes it shows a spinner on a neutral
// backdrop; on failure (including a stall) it shows a tappable retry button.
// Drop-in for chat thumbnails and the full-screen viewer.
//
// Contract:
//   • source can be null/undefined  → renders the empty placeholder (no spinner).
//   • source is a data:/file:/sticker/external url  → passes through.
//   • source is a supabase-media url  → signs it once (60m TTL) via signedMediaUrl.
//   • On ANY failure (sign, network, decode, stall) we surface retry — never black.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { useSignedUrl, type SignedUrlOptions } from '../lib/useSignedUrl';
import type { MediaKind } from '../lib/mediaPolicy';

interface Props {
  /** Stored media_url (public link, data URI, sticker, or local uri). */
  source: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Cache key override so a rotating signed token still hits expo-image's cache. */
  cacheKey?: string;
  /** Spinner + retry glyph tint. */
  tint?: string;
  /** Backdrop shown behind the image while loading (never pure black). */
  placeholderBackground?: string;
  /** Optional transition (ms) for a soft fade-in once decoded. */
  transition?: number;
  /** Show the retry affordance on failure (default true). */
  showRetry?: boolean;
  /** Reports the decoded bitmap's intrinsic pixel size (for the Info panel). */
  onNaturalSize?: (width: number, height: number) => void;
  /** How long to wait for onLoad/onError before assuming the fetch is stuck.
   *  Set to 0 to disable. Default 12 s — long enough for slow 3G, short enough
   *  that the user isn't staring at a spinner forever. */
  stallTimeoutMs?: number;
  /**
   * Permanent disk cache. Default false (on-demand). Set true after user opens
   * media, or pass kind for policy-based auto-download.
   */
  persist?: boolean;
  kind?: MediaKind;
}

export default function SignedImage({
  source,
  style,
  containerStyle,
  contentFit = 'cover',
  cacheKey,
  tint = '#fff',
  placeholderBackground = 'rgba(255,255,255,0.04)',
  transition = 180,
  showRetry = true,
  onNaturalSize,
  stallTimeoutMs = 12000,
  persist = false,
  kind,
}: Props) {
  const opts: SignedUrlOptions = { persist, kind };
  const { url, loading: resolving, error: signError, retry: retrySign, fromCache } = useSignedUrl(source, opts);
  // Local/offline hits should not flash a spinner — only network first-loads.
  const [decoding, setDecoding] = useState(!fromCache);
  const [decodeError, setDecodeError] = useState(false);
  const [stalled, setStalled] = useState(false);
  // Bumped on every retry to force expo-image to drop its cached decode and refetch.
  const [nonce, setNonce] = useState(0);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = () => {
    if (stallTimer.current) { clearTimeout(stallTimer.current); stallTimer.current = null; }
  };
  const armStallTimer = () => {
    if (!stallTimeoutMs) return;
    clearStallTimer();
    stallTimer.current = setTimeout(() => setStalled(true), stallTimeoutMs);
  };

  // Reset decode state whenever we get a fresh url (or retry).
  // Cached local files skip the stall timer — they should decode almost instantly.
  useEffect(() => {
    if (!url) return;
    setDecoding(true);
    setDecodeError(false);
    setStalled(false);
    if (!fromCache && !url.startsWith('file://') && !url.startsWith('data:')) {
      armStallTimer();
    }
    return clearStallTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, fromCache]);

  useEffect(() => () => clearStallTimer(), []);

  const failed = decodeError || stalled || (signError && !url);
  // Never spin for local/offline cache hits after first frame attempt.
  const busy = !failed && (resolving || (!!url && decoding && !fromCache));

  const onRetry = () => {
    setDecodeError(false);
    setDecoding(true);
    setStalled(false);
    setNonce((n) => n + 1);
    retrySign();
  };

  // Nothing to show at all — render an empty placeholder (chat bubbles ask for
  // this shape when the message has no media yet).
  const empty = !source;

  return (
    <View style={[styles.container, { backgroundColor: placeholderBackground }, containerStyle]}>
      {!!url && !failed && (
        <Image
          key={nonce /* force a fresh decode on retry, bypassing a bad cache entry */}
          source={{ uri: url, cacheKey: cacheKey ?? mediaKey(source) }}
          style={[StyleSheet.absoluteFill, style as StyleProp<ImageStyle>]}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          transition={transition}
          onLoadStart={() => {
            setDecoding(true);
            setStalled(false);
            armStallTimer();
          }}
          onLoad={(e) => {
            clearStallTimer();
            setDecoding(false);
            setDecodeError(false);
            setStalled(false);
            const src = e?.source;
            if (src?.width && src?.height) onNaturalSize?.(src.width, src.height);
          }}
          onError={() => {
            clearStallTimer();
            setDecoding(false);
            setDecodeError(true);
          }}
        />
      )}

      {busy && !empty && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={tint} />
        </View>
      )}

      {failed && showRetry && (
        <Pressable style={styles.overlay} onPress={onRetry} hitSlop={12} accessibilityRole="button" accessibilityLabel="Retry loading media">
          <Ionicons name="reload" size={26} color={tint} />
          <Text style={[styles.retryText, { color: tint }]}>Tap to retry</Text>
        </Pressable>
      )}

      {failed && !showRetry && (
        // Non-interactive fallback (e.g. tiny thumbnails in the strip) — show a
        // broken-image glyph so it never renders as an unexplained black tile.
        <View style={styles.overlay} pointerEvents="none">
          <Ionicons name="image-outline" size={20} color={tint} />
        </View>
      )}
    </View>
  );
}

// Derive a stable cache key from the stored url (its object path if it's media),
// so the same asset caches regardless of which signed token is currently live.
function mediaKey(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  const m = source.match(/\/media\/([^?#]+)/);
  return m ? `media:${decodeURIComponent(m[1])}` : source;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  retryText: { fontSize: 12, fontWeight: '600' },
});
