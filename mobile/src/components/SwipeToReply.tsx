// Lumixo mobile — WhatsApp-style swipe + long-press + double-tap.
//
// • Swipe right (short distance) → reply, haptic at arm threshold, fires on release
// • Swipe left → optional delete (call history)
// • Long-press → selection / actions
// • Double-tap → default reaction (optional)
//
// Gesture isolation:
//  - Pan uses activeOffsetX + failOffsetY so vertical scroll wins.
//  - Long-press / double-tap Exclusive with pan (no accidental archive/dismiss).
//  - Callbacks always via stable runOnJS wrappers (never optional in worklets).
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

/** Short WhatsApp-like arm distance (px). */
const THRESHOLD = 48;
const MAX_DRAG = 80;
const LONG_PRESS_MS = 320;

interface Props {
  children: React.ReactNode;
  /** Swipe right → reply. Omit to disable right-swipe. */
  onReply?: () => void;
  /** Swipe left → delete (call history, etc.). */
  onSwipeDelete?: () => void;
  /** Press-and-hold the whole row. */
  onLongPress?: () => void;
  /** Double-tap → quick reaction (e.g. ❤️). */
  onDoubleTap?: () => void;
  /** Enables horizontal swipe gestures. */
  enabled?: boolean;
  tint?: string;
  deleteTint?: string;
}

function hapticArm() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function hapticFire() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
function hapticSelect() {
  Haptics.selectionAsync().catch(() => {});
}

export default function SwipeToReply({
  children,
  onReply,
  onSwipeDelete,
  onLongPress,
  onDoubleTap,
  enabled = true,
  tint = '#25d366',
  deleteTint = '#EF4444',
}: Props) {
  const tx = useSharedValue(0);
  const armedReply = useSharedValue(false);
  const armedDelete = useSharedValue(false);
  const iconPulse = useSharedValue(1);

  const fireReply = useCallback(() => {
    try {
      hapticFire();
      onReply?.();
    } catch {
      /* never crash */
    }
  }, [onReply]);

  const fireDelete = useCallback(() => {
    try {
      hapticFire();
      onSwipeDelete?.();
    } catch {
      /* never crash */
    }
  }, [onSwipeDelete]);

  const fireLongPress = useCallback(() => {
    try {
      hapticSelect();
      onLongPress?.();
    } catch {
      /* never crash */
    }
  }, [onLongPress]);

  const fireDoubleTap = useCallback(() => {
    try {
      hapticArm();
      onDoubleTap?.();
    } catch {
      /* never crash */
    }
  }, [onDoubleTap]);

  const canReply = enabled && typeof onReply === 'function';
  const canDelete = enabled && typeof onSwipeDelete === 'function';
  const canLongPress = typeof onLongPress === 'function';
  const canDouble = typeof onDoubleTap === 'function';

  const allowReply = useSharedValue(canReply ? 1 : 0);
  const allowDelete = useSharedValue(canDelete ? 1 : 0);
  useEffect(() => {
    allowReply.value = canReply ? 1 : 0;
    allowDelete.value = canDelete ? 1 : 0;
  }, [canReply, canDelete, allowReply, allowDelete]);

  // Directional pan — fails if user scrolls vertically first.
  const pan = Gesture.Pan()
    .enabled(canReply || canDelete)
    .activeOffsetX(
      canReply && canDelete
        ? [-12, 12]
        : canReply
          ? [12, 10000]
          : [-10000, -12],
    )
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      'worklet';
      let x = e.translationX;
      if (allowReply.value === 0 && x > 0) x = 0;
      if (allowDelete.value === 0 && x < 0) x = 0;

      if (x >= 0) {
        const raw = x;
        // Rubber-band after threshold (short swipe feel).
        tx.value =
          raw <= THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.28;
        if (tx.value > MAX_DRAG) tx.value = MAX_DRAG;
        if (tx.value >= THRESHOLD && !armedReply.value) {
          armedReply.value = true;
          armedDelete.value = false;
          iconPulse.value = withTiming(1.15, { duration: 80 }, () => {
            iconPulse.value = withTiming(1, { duration: 100 });
          });
          runOnJS(hapticArm)();
        } else if (tx.value < THRESHOLD * 0.85 && armedReply.value) {
          armedReply.value = false;
        }
      } else {
        const raw = -x;
        const mag =
          raw <= THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.28;
        tx.value = -Math.min(mag, MAX_DRAG);
        if (mag >= THRESHOLD && !armedDelete.value) {
          armedDelete.value = true;
          armedReply.value = false;
          runOnJS(hapticArm)();
        } else if (mag < THRESHOLD * 0.85 && armedDelete.value) {
          armedDelete.value = false;
        }
      }
    })
    .onEnd(() => {
      'worklet';
      if (armedReply.value) {
        runOnJS(fireReply)();
      } else if (armedDelete.value) {
        runOnJS(fireDelete)();
      }
      armedReply.value = false;
      armedDelete.value = false;
      tx.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.45 });
    })
    .onFinalize(() => {
      'worklet';
      // Cancel mid-swipe (interrupted by scroll) — reset cleanly.
      if (tx.value !== 0 && !armedReply.value && !armedDelete.value) {
        tx.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.45 });
      }
    });

  const longPress = Gesture.LongPress()
    .enabled(canLongPress)
    .minDuration(LONG_PRESS_MS)
    .maxDistance(12)
    .onStart(() => {
      'worklet';
      runOnJS(fireLongPress)();
    });

  const doubleTap = Gesture.Tap()
    .enabled(canDouble)
    .numberOfTaps(2)
    .maxDuration(280)
    .onEnd(() => {
      'worklet';
      runOnJS(fireDoubleTap)();
    });

  // Double-tap Exclusive with long-press; both Simultaneous with pan so
  // horizontal swipe still works when vertical scroll isn't competing.
  const taps = Gesture.Exclusive(doubleTap, longPress);
  const gesture = Gesture.Simultaneous(pan, taps);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [6, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale:
          iconPulse.value *
          interpolate(tx.value, [0, THRESHOLD], [0.45, 1], Extrapolation.CLAMP),
      },
      {
        translateX: interpolate(
          tx.value,
          [0, THRESHOLD],
          [-6, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const deleteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-6, -THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          tx.value,
          [0, -THRESHOLD],
          [0.45, 1],
          Extrapolation.CLAMP,
        ),
      },
      {
        translateX: interpolate(
          tx.value,
          [0, -THRESHOLD],
          [6, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <View collapsable={false}>
      {canReply ? (
        <Animated.View style={[styles.iconLeft, replyIconStyle]} pointerEvents="none">
          <View style={[styles.iconCircle, { backgroundColor: tint + '22' }]}>
            <Ionicons name="arrow-undo" size={18} color={tint} />
          </View>
        </Animated.View>
      ) : null}
      {canDelete ? (
        <Animated.View style={[styles.iconRight, deleteIconStyle]} pointerEvents="none">
          <View style={[styles.iconCircle, { backgroundColor: deleteTint + '22' }]}>
            <Ionicons name="trash" size={18} color={deleteTint} />
          </View>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle} collapsable={false}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  iconLeft: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  iconRight: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
