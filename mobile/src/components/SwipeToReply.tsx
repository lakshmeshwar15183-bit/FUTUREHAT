// Lumixo mobile — WhatsApp-style swipe-to-reply + long-press. Wrap any
// message row: drag it to the right to reply, or press-and-hold to open the
// message actions / reaction menu. BOTH gestures live in react-native-gesture-
// handler so a single native touch-arbiter coordinates them (and the vertical
// list scroll) — no RN-Pressable-vs-RNGH contention, which is what made the old
// long-press slow/unreliable and dead while the keyboard was up.
// Works for every message type because it wraps the whole bubble.
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

const THRESHOLD = 56; // px the row must travel to arm a reply
const MAX = 92; // max drag distance (rubber-banded beyond threshold)
// Native-feeling press-and-hold delay for the message actions menu (WhatsApp is
// ~300ms; RN's default is a sluggish 500). Kept well below the swipe activation
// so a still finger fires the menu long before any drag could.
const LONG_PRESS_MS = 300;

interface Props {
  children: React.ReactNode;
  onReply: () => void;
  /** Press-and-hold the whole bubble to open the actions menu. Omit to disable
   *  (e.g. deleted messages). Independent of `enabled` so long-press still works
   *  in selection mode where swipe-to-reply is turned off. */
  onLongPress?: () => void;
  enabled?: boolean;
  tint?: string;
}

function buzz() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export default function SwipeToReply({ children, onReply, onLongPress, enabled = true, tint = '#25d366' }: Props) {
  const tx = useSharedValue(0);
  const armed = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([14, 10000]) // only engage on a clear rightward drag
    .failOffsetY([-14, 14]) // yield to vertical list scrolling
    .onUpdate((e) => {
      // rubber-band: full movement up to THRESHOLD, damped beyond it
      const raw = Math.max(0, e.translationX);
      tx.value = raw <= THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.35;
      if (tx.value >= THRESHOLD && !armed.value) {
        armed.value = true;
        runOnJS(buzz)();
      } else if (tx.value < THRESHOLD && armed.value) {
        armed.value = false;
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
      armed.value = false;
      tx.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.5 });
    });

  // Long-press covers the ENTIRE bubble (text, media, reply preview, audio) as
  // one native target. maxDistance(10) < the pan's 14px activation, so the two
  // never both fire: a still hold opens the menu; any real drag/scroll moves the
  // finger past 10px first, cancelling the hold and letting pan/scroll take over
  // (so scrolling never triggers an accidental long-press).
  const longPress = Gesture.LongPress()
    .enabled(!!onLongPress)
    .minDuration(LONG_PRESS_MS)
    .maxDistance(10)
    .onStart(() => {
      if (onLongPress) runOnJS(onLongPress)();
    });

  // Simultaneous (not Exclusive) so the long-press timer isn't gated behind the
  // pan failing — the disjoint activation regions above already keep them apart.
  const gesture = Gesture.Simultaneous(pan, longPress);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [8, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(tx.value, [0, THRESHOLD], [0.4, 1], Extrapolation.CLAMP) },
      { translateX: interpolate(tx.value, [0, THRESHOLD], [-8, 0], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View>
      <Animated.View style={[styles.icon, iconStyle]} pointerEvents="none">
        <Ionicons name="arrow-undo" size={20} color={tint} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    width: Math.min(MAX, 40),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
