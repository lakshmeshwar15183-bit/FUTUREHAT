// Lumixo mobile — WhatsApp-style swipe + long-press.
//
// • Swipe right → reply (normal bubbles)
// • Swipe left  → delete (call history)
// • Long-press  → selection / actions menu
//
// Callbacks are always invoked via stable runOnJS wrappers (never optional
// functions directly inside worklets — that crashed chat on open/swipe).
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const THRESHOLD = 56;
const MAX = 92;
const LONG_PRESS_MS = 300;

interface Props {
  children: React.ReactNode;
  /** Swipe right → reply. Omit to disable right-swipe. */
  onReply?: () => void;
  /** Swipe left → delete (call history, etc.). */
  onSwipeDelete?: () => void;
  /** Press-and-hold the whole row. */
  onLongPress?: () => void;
  /** Enables horizontal swipe gestures. */
  enabled?: boolean;
  tint?: string;
  deleteTint?: string;
}

function buzz() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export default function SwipeToReply({
  children,
  onReply,
  onSwipeDelete,
  onLongPress,
  enabled = true,
  tint = '#25d366',
  deleteTint = '#EF4444',
}: Props) {
  const tx = useSharedValue(0);
  const armedReply = useSharedValue(false);
  const armedDelete = useSharedValue(false);

  // Stable JS-thread callbacks for runOnJS (never pass maybe-undefined into worklets).
  const fireReply = useCallback(() => {
    try {
      onReply?.();
    } catch {
      /* never crash the UI thread */
    }
  }, [onReply]);

  const fireDelete = useCallback(() => {
    try {
      onSwipeDelete?.();
    } catch {
      /* never crash the UI thread */
    }
  }, [onSwipeDelete]);

  const fireLongPress = useCallback(() => {
    try {
      onLongPress?.();
    } catch {
      /* never crash the UI thread */
    }
  }, [onLongPress]);

  const canReply = enabled && typeof onReply === 'function';
  const canDelete = enabled && typeof onSwipeDelete === 'function';
  const canLongPress = typeof onLongPress === 'function';

  // Capture direction flags as shared values so worklets never read React props.
  const allowReply = useSharedValue(canReply ? 1 : 0);
  const allowDelete = useSharedValue(canDelete ? 1 : 0);
  allowReply.value = canReply ? 1 : 0;
  allowDelete.value = canDelete ? 1 : 0;

  // Directional activation: only arm the axes we support (avoids scroll fights).
  const pan = Gesture.Pan()
    .enabled(canReply || canDelete)
    .activeOffsetX(canReply && canDelete ? [-14, 14] : canReply ? [14, 10000] : [-10000, -14])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      'worklet';
      let x = e.translationX;
      if (allowReply.value === 0 && x > 0) x = 0;
      if (allowDelete.value === 0 && x < 0) x = 0;

      if (x >= 0) {
        const raw = x;
        tx.value = raw <= THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.35;
        if (tx.value >= THRESHOLD && !armedReply.value) {
          armedReply.value = true;
          armedDelete.value = false;
          runOnJS(buzz)();
        } else if (tx.value < THRESHOLD && armedReply.value) {
          armedReply.value = false;
        }
      } else {
        const raw = -x;
        const mag = raw <= THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.35;
        tx.value = -mag;
        if (mag >= THRESHOLD && !armedDelete.value) {
          armedDelete.value = true;
          armedReply.value = false;
          runOnJS(buzz)();
        } else if (mag < THRESHOLD && armedDelete.value) {
          armedDelete.value = false;
        }
      }
    })
    .onEnd(() => {
      'worklet';
      if (armedReply.value) {
        runOnJS(fireReply)();
      }
      if (armedDelete.value) {
        runOnJS(fireDelete)();
      }
      armedReply.value = false;
      armedDelete.value = false;
      tx.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.5 });
    });

  const longPress = Gesture.LongPress()
    .enabled(canLongPress)
    .minDuration(LONG_PRESS_MS)
    .maxDistance(10)
    .onStart(() => {
      'worklet';
      runOnJS(fireLongPress)();
    });

  const gesture = Gesture.Simultaneous(pan, longPress);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [8, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(tx.value, [0, THRESHOLD], [0.4, 1], Extrapolation.CLAMP) },
      { translateX: interpolate(tx.value, [0, THRESHOLD], [-8, 0], Extrapolation.CLAMP) },
    ],
  }));
  const deleteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-8, -THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(tx.value, [0, -THRESHOLD], [0.4, 1], Extrapolation.CLAMP) },
      { translateX: interpolate(tx.value, [0, -THRESHOLD], [8, 0], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View>
      {canReply ? (
        <Animated.View style={[styles.iconLeft, replyIconStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={20} color={tint} />
        </Animated.View>
      ) : null}
      {canDelete ? (
        <Animated.View style={[styles.iconRight, deleteIconStyle]} pointerEvents="none">
          <Ionicons name="trash" size={20} color={deleteTint} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  iconLeft: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    width: Math.min(MAX, 40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRight: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    width: Math.min(MAX, 40),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
