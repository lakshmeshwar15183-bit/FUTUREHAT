// Lumixo — full-screen media-editor image surface (WhatsApp-class).
// Never shows a silent black frame: spinner while decoding, Retry on failure.
// Pinch-to-zoom + pan when zoomed; double-tap toggles 1× / 2.5×.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  /** Natural pixel size (optional — used only for accessibility). */
  width?: number;
  height?: number;
  /** Allow pinch/pan (preview shell). Tools may disable. */
  zoomable?: boolean;
};

export default function PreviewImage({
  uri,
  style,
  width,
  height,
  zoomable = true,
}: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);

  // Reset load state whenever the working URI changes (crop/draw bake).
  useEffect(() => {
    setStatus('loading');
  }, [uri, nonce]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(() => {
    // Reset zoom on new image
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [uri, scale, savedScale, tx, ty, savedTx, savedTy]);

  const retry = useCallback(() => {
    setStatus('loading');
    setNonce((n) => n + 1);
  }, []);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(zoomable)
        .onUpdate((e) => {
          const next = Math.max(1, Math.min(5, savedScale.value * e.scale));
          if (Number.isFinite(next)) scale.value = next;
        })
        .onEnd(() => {
          savedScale.value = scale.value;
          if (scale.value <= 1.02) {
            scale.value = withTiming(1);
            tx.value = withTiming(0);
            ty.value = withTiming(0);
            savedScale.value = 1;
            savedTx.value = 0;
            savedTy.value = 0;
          }
        }),
    [zoomable, scale, savedScale, tx, ty, savedTx, savedTy],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(zoomable)
        .averageTouches(true)
        .onUpdate((e) => {
          if (scale.value <= 1.02) return;
          tx.value = savedTx.value + e.translationX;
          ty.value = savedTy.value + e.translationY;
        })
        .onEnd(() => {
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        }),
    [zoomable, scale, tx, ty, savedTx, savedTy],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(zoomable)
        .numberOfTaps(2)
        .onEnd(() => {
          if (scale.value > 1.2) {
            scale.value = withTiming(1);
            tx.value = withTiming(0);
            ty.value = withTiming(0);
            savedScale.value = 1;
            savedTx.value = 0;
            savedTy.value = 0;
          } else {
            scale.value = withTiming(2.5);
            savedScale.value = 2.5;
          }
        }),
    [zoomable, scale, tx, ty, savedScale, savedTx, savedTy],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [pinch, pan, doubleTap],
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const a11y = width && height ? `Photo ${width} by ${height}` : 'Photo preview';

  return (
    <View style={[styles.root, style]} accessibilityLabel={a11y}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.fill, animStyle]}>
          <Image
            // Key forces a clean reload on Retry / URI change (no stale black decode).
            key={`${uri}#${nonce}`}
            source={{ uri }}
            style={styles.image}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            transition={0}
            onLoadStart={() => setStatus('loading')}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
            // Prefer full-res decode for editor (not thumbnail).
            priority="high"
          />
        </Animated.View>
      </GestureDetector>

      {status === 'loading' && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Loading photo…</Text>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.overlay}>
          <Ionicons name="image-outline" size={48} color="rgba(255,255,255,0.55)" />
          <Text style={styles.overlayTitle}>Couldn’t load photo</Text>
          <Text style={styles.overlayText}>Check permissions or try another image.</Text>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading photo"
          >
            <Ionicons name="refresh" size={18} color="#111" />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 10,
    paddingHorizontal: 24,
  },
  overlayTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
  },
  overlayText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F5C518',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 15,
  },
});
