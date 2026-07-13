// Lumixo mobile — WhatsApp-style swipe + long-press.
//
// • Swipe right → reply (default, normal bubbles)
// • Swipe left  → delete (optional; call-history / delete-only rows)
// • Long-press  → selection / actions menu
//
// Gestures live in react-native-gesture-handler so they share a native arbiter
// with the inverted FlatList (no RN Pressable contention).
import React from 'react';
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
  /** Press-and-hold the whole row. Independent of swipe `enabled`. */
  onLongPress?: () => void;
  /** Enables horizontal swipe gestures. */
  enabled?: boolean;
  tint?: string;
  /** Color for the left-swipe delete affordance. */
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

  const canReply = enabled && !!onReply;
  const canDelete = enabled && !!onSwipeDelete;

  const pan = Gesture.Pan()
    .enabled(canReply || canDelete)
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      let x = e.translationX;
      // Clamp to allowed directions
      if (!canReply && x > 0) x = 0;
      if (!canDelete && x < 0) x = 0;

      if (x >= 0) {
        // Right: reply
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
        // Left: delete
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
      if (armedReply.value && onReply) runOnJS(onReply)();
      if (armedDelete.value && onSwipeDelete) runOnJS(onSwipeDelete)();
      armedReply.value = false;
      armedDelete.value = false;
      tx.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.5 });
    });

  const longPress = Gesture.LongPress()
    .enabled(!!onLongPress)
    .minDuration(LONG_PRESS_MS)
    .maxDistance(10)
    .onStart(() => {
      if (onLongPress) runOnJS(onLongPress)();
    });

  const gesture = Gesture.Simultaneous(pan, longPress);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
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
      {canReply && (
        <Animated.View style={[styles.iconLeft, replyIconStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={20} color={tint} />
        </Animated.View>
      )}
      {canDelete && (
        <Animated.View style={[styles.iconRight, deleteIconStyle]} pointerEvents="none">
          <Ionicons name="trash" size={20} color={deleteTint} />
        </Animated.View>
      )}
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
