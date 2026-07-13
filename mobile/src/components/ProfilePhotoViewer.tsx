// Lumixo — full-screen profile photo viewer (WhatsApp-grade).
// Pinch / double-tap zoom, pan while zoomed, swipe-down to dismiss,
// black backdrop, smooth entrance. Uses signed/cached URLs via SignedImage.
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

export default function ProfilePhotoViewer({
  visible,
  uri,
  name,
  onClose,
}: ProfilePhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

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
            {uri ? (
              <SignedImage
                source={uri}
                style={{ width: screenW, height: screenH * 0.72 }}
                contentFit="contain"
                cacheKey={uri}
                kind="avatar"
                persist
                placeholderBackground="rgba(0,0,0,0.2)"
              />
            ) : (
              <View style={styles.empty}>
                <Ionicons name="person" size={96} color="rgba(255,255,255,0.35)" />
                <Text style={styles.emptyText}>No profile photo</Text>
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
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
});
