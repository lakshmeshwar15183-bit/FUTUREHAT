// Lumixo — native sticker card (emoji + bg). Never uses SVG data-URIs / Image.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

export interface StickerViewProps {
  emoji: string;
  bg?: string;
  animated?: boolean;
  size?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Smaller corner radius for bubble vs picker. */
  compact?: boolean;
}

export default function StickerView({
  emoji,
  bg = '#2a3441',
  animated = false,
  size = 120,
  onPress,
  onLongPress,
  style,
  compact = false,
}: StickerViewProps) {
  const bounce = useSharedValue(1);

  useEffect(() => {
    if (!animated) {
      bounce.value = 1;
      return;
    }
    bounce.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [animated, bounce]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bounce.value }],
  }));

  const radius = compact ? Math.round(size * 0.16) : Math.round(size * 0.2);
  const fontSize = Math.round(size * 0.52);

  const inner = (
    <Animated.View
      style={[
        styles.card,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
        },
        animStyle,
        style,
      ]}
    >
      <Text style={[styles.emoji, { fontSize, lineHeight: fontSize + 6 }]} allowFontScaling={false}>
        {emoji}
      </Text>
    </Animated.View>
  );

  if (onPress || onLongPress) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => pressed && styles.pressed}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  emoji: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
});
