// Lumixo — WhatsApp-style status ring around an avatar.
// Unseen: solid brand primary. Seen: muted border. Multi-segment when
// the author has multiple status items (1..N segments around the circle).
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '../../theme';

export type StatusRingState = 'none' | 'unseen' | 'seen';

interface Props {
  size: number;
  state: StatusRingState;
  /** Number of status items (for multi-segment ring). Default 1. */
  segments?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const GAP_DEG = 12; // gap between multi-segments

/**
 * Draws a circular ring. For multi-segment we approximate with stacked
 * border rings rotated by segment (simple, performant, no Skia required).
 * Single segment uses a clean border.
 */
export default function StatusRing({
  size,
  state,
  segments = 1,
  children,
  style,
}: Props) {
  const colors = useColors();
  const pad = state === 'none' ? 0 : Math.max(2, Math.round(size * 0.045));
  const outer = size + pad * 2 + (state === 'none' ? 0 : 4);
  const appear = useSharedValue(state === 'none' ? 0 : 1);

  useEffect(() => {
    appear.value = withTiming(state === 'none' ? 0 : 1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [state, appear]);

  const ringColor = state === 'unseen' ? colors.primary : colors.border;
  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + appear.value * 0.65,
    transform: [{ scale: 0.92 + appear.value * 0.08 }],
  }));

  const segs = Math.max(1, Math.min(segments, 12));

  const multi = useMemo(() => {
    if (state === 'none' || segs <= 1) return null;
    // Approximate multi-segment with short border arcs via rotated half-circles
    // (visual cue that multiple updates exist — not pixel-perfect arcs).
    const items: React.ReactNode[] = [];
    const step = 360 / segs;
    for (let i = 0; i < segs; i++) {
      items.push(
        <View
          key={i}
          style={[
            styles.seg,
            {
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: 2.5,
              borderColor: 'transparent',
              // Only top arc visible → rotate for each segment
              borderTopColor: ringColor,
              borderRightColor: segs > 2 ? ringColor : 'transparent',
              transform: [{ rotate: `${i * step + GAP_DEG / 2}deg` }],
            },
          ]}
          pointerEvents="none"
        />,
      );
    }
    return items;
  }, [state, segs, outer, ringColor]);

  if (state === 'none') {
    return <View style={[{ width: size, height: size }, style]}>{children}</View>;
  }

  return (
    <Animated.View
      style={[
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        animStyle,
        style,
      ]}
    >
      {segs <= 1 ? (
        <View
          style={{
            position: 'absolute',
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: 2.5,
            borderColor: ringColor,
          }}
          pointerEvents="none"
        />
      ) : (
        multi
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: colors.surface,
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  seg: {
    position: 'absolute',
  },
});
