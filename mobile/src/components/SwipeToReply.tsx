// FUTUREHAT mobile — WhatsApp-style swipe-to-reply. Wrap any message row: drag
// it to the right, a reply arrow fades in, a haptic fires once past the
// threshold, and on release the row springs back and onReply() is invoked.
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

interface Props {
  children: React.ReactNode;
  onReply: () => void;
  enabled?: boolean;
  tint?: string;
}

function buzz() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export default function SwipeToReply({ children, onReply, enabled = true, tint = '#25d366' }: Props) {
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
      <GestureDetector gesture={pan}>
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
