// Lumixo — full-screen profile photo viewer (WhatsApp-grade).
// Pinch / double-tap zoom, pan while zoomed, swipe-down to dismiss,
// black backdrop, smooth entrance. Uses signed/cached URLs via SignedImage.
//
// CRITICAL: SignedImage must receive a sized container (width × height). Passing
// dimensions only on the image style used to collapse the view to 0×0 → black
// screen while the avatar on the profile screen still rendered correctly.
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import SignedImage from './SignedImage';
import {
  clampOffset as clamp,
  isValidScale,
  isValidTransform,
  maxOffset,
  safeClampScale,
} from './mediaViewerMath';

export interface ProfilePhotoViewerProps {
  visible: boolean;
  uri: string | null | undefined;
  name?: string | null;
  onClose: () => void;
}

const AVATAR_PALETTE = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#3FB0E0'];

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorFor(name?: string | null): string {
  if (!name) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[h];
}

/** Stable expo-image cache key (path without rotating query tokens). */
function stableCacheKey(uri: string | null | undefined): string | undefined {
  if (!uri) return undefined;
  const m = uri.match(/\/media\/([^?#]+)/);
  if (m) return `avatar:${decodeURIComponent(m[1])}`;
  const bare = uri.split('?')[0];
  return bare || uri;
}

export default function ProfilePhotoViewer({
  visible,
  uri,
  name,
  onClose,
}: ProfilePhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  // Fit image in the stage between chrome and safe bottom (WhatsApp-like).
  const imgW = screenW;
  const imgH = Math.max(240, Math.round(screenH * 0.72));

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const backdrop = useSharedValue(0);
  const enter = useSharedValue(0.92);
  const dismissY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
      dismissY.value = 0;
      backdrop.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
      enter.value = withSpring(1, { damping: 18, stiffness: 220 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      backdrop.value = 0;
      enter.value = 0.92;
    }
  }, [visible, backdrop, enter, scale, savedScale, tx, ty, savedTx, savedTy, dismissY]);

  const close = useCallback(() => {
    backdrop.value = withTiming(0, { duration: 160 });
    enter.value = withTiming(0.94, { duration: 160 }, (fin) => {
      if (fin) runOnJS(onClose)();
    });
  }, [backdrop, enter, onClose]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      if (!isFinite(e.scale) || e.scale <= 0) return;
      if (!isFinite(savedScale.value) || savedScale.value < 1) savedScale.value = 1;
      const next = safeClampScale(savedScale.value * e.scale);
      if (isValidScale(next)) scale.value = next;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        savedScale.value = scale.value;
        const mx = maxOffset(screenW, scale.value);
        const my = maxOffset(screenH, scale.value);
        tx.value = withTiming(clamp(tx.value, mx));
        ty.value = withTiming(clamp(ty.value, my));
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value > 1.02) {
        const mx = maxOffset(screenW, scale.value);
        const my = maxOffset(screenH, scale.value);
        const nx = savedTx.value + e.translationX;
        const ny = savedTy.value + e.translationY;
        if (isValidTransform(nx) && isValidTransform(ny)) {
          tx.value = clamp(nx, mx);
          ty.value = clamp(ny, my);
        }
      } else if (e.translationY > 0 && Math.abs(e.translationY) > Math.abs(e.translationX)) {
        dismissY.value = e.translationY;
        backdrop.value = Math.max(0.25, 1 - e.translationY / 400);
      }
    })
    .onEnd((e) => {
      if (scale.value > 1.02) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        return;
      }
      if (e.translationY > 110 || e.velocityY > 900) {
        runOnJS(close)();
      } else {
        dismissY.value = withSpring(0, { damping: 18, stiffness: 220 });
        backdrop.value = withTiming(1, { duration: 160 });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1.05) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        const target = 2.4;
        scale.value = withTiming(target);
        const nx = (screenW / 2 - e.x) * (target - 1);
        const ny = (screenH / 2 - e.y) * (target - 1);
        const mx = maxOffset(screenW, target);
        const my = maxOffset(screenH, target);
        tx.value = withTiming(clamp(nx, mx));
        ty.value = withTiming(clamp(ny, my));
        savedScale.value = target;
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + dismissY.value },
      { scale: scale.value * enter.value },
    ],
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value,
  }));

  const title = useMemo(
    () => (name?.trim() ? name.trim() : 'Profile photo'),
    [name],
  );

  const hasPhoto = !!(uri && String(uri).trim().length > 0);
  const cacheKey = useMemo(() => stableCacheKey(uri), [uri]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.backdrop, bgStyle]} />
        <View style={[styles.chrome, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <Pressable
            onPress={close}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close profile photo"
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.stage, imgStyle]}>
            {hasPhoto ? (
              <SignedImage
                source={uri}
                // Size the CONTAINER — Image is absoluteFill inside (zero-size bug fix).
                containerStyle={{ width: imgW, height: imgH }}
                style={{ width: imgW, height: imgH }}
                contentFit="contain"
                cacheKey={cacheKey}
                kind="avatar"
                persist
                transition={160}
                stallTimeoutMs={15000}
                placeholderBackground="rgba(20,20,20,0.9)"
                tint="#fff"
                showRetry
              />
            ) : (
              <View
                style={[
                  styles.empty,
                  { width: Math.min(200, imgW * 0.5), height: Math.min(200, imgW * 0.5), borderRadius: 999 },
                  { backgroundColor: colorFor(name) },
                ]}
              >
                <Text style={[styles.emptyInitials, { fontSize: Math.min(200, imgW * 0.5) * 0.4 }]}>
                  {initials(name)}
                </Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyInitials: {
    color: '#fff',
    fontWeight: '700',
  },
});
