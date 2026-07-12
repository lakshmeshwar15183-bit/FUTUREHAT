/**
 * Lumixo official mascot — "Lumi" (mobile).
 * View + Reanimated transforms only (no react-native-svg dependency).
 * GPU-friendly: transform/opacity. Respects Reduce Motion.
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  type CatMood,
  type CatSize,
  CAT_SIZE_PX,
  catAriaLabel,
} from '../../../shared/lumixoCat';
import { useColors } from '../theme';

export interface LumixoCatProps {
  mood?: CatMood;
  gaze?: number;
  size?: CatSize;
  decorative?: boolean;
  style?: ViewStyle;
}

const easeInOut = Easing.inOut(Easing.sin);

export function LumixoCat({
  mood = 'idle',
  gaze = 0.5,
  size = 'lg',
  decorative = true,
  style,
}: LumixoCatProps) {
  const colors = useColors();
  const px = CAT_SIZE_PX[size];
  const accent = colors.primary;

  const breath = useSharedValue(1);
  const tail = useSharedValue(0);
  const headRot = useSharedValue(0);
  const headY = useSharedValue(0);
  const pawsY = useSharedValue(22);
  const pawsOp = useSharedValue(0);
  const eyesOp = useSharedValue(1);
  const celebrate = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => setReduceMotion(!!v));
    sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion) as any;
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    cancelAnimation(breath);
    cancelAnimation(tail);
    cancelAnimation(headRot);
    cancelAnimation(headY);
    cancelAnimation(pawsY);
    cancelAnimation(pawsOp);
    cancelAnimation(celebrate);
    cancelAnimation(eyesOp);

    if (reduceMotion) {
      breath.value = 1;
      tail.value = 0;
      headRot.value = mood === 'confused' ? -8 : 0;
      headY.value = 0;
      pawsY.value = mood === 'hiding' ? 0 : 22;
      pawsOp.value = mood === 'hiding' ? 1 : 0;
      eyesOp.value = mood === 'hiding' || mood === 'sleeping' ? 0 : 1;
      celebrate.value = mood === 'celebrating' ? 1 : 0;
      return;
    }

    // Breathing
    if (mood === 'idle' || mood === 'watching' || mood === 'sleeping' || mood === 'hiding') {
      breath.value = withRepeat(
        withSequence(
          withTiming(1.025, { duration: 1600, easing: easeInOut }),
          withTiming(1, { duration: 1600, easing: easeInOut }),
        ),
        -1,
        false,
      );
    } else {
      breath.value = withTiming(1, { duration: 200 });
    }

    // Tail
    const tailAmp = mood === 'celebrating' ? 1 : mood === 'watching' ? 0.7 : 0.35;
    const tailDur = mood === 'celebrating' ? 280 : mood === 'watching' ? 700 : 1400;
    tail.value = withRepeat(
      withSequence(
        withTiming(tailAmp, { duration: tailDur, easing: easeInOut }),
        withTiming(-tailAmp, { duration: tailDur, easing: easeInOut }),
      ),
      -1,
      true,
    );

    // Head
    if (mood === 'confused') {
      headRot.value = withSequence(
        withTiming(-14, { duration: 90 }),
        withTiming(12, { duration: 100 }),
        withTiming(-10, { duration: 90 }),
        withTiming(8, { duration: 90 }),
        withTiming(0, { duration: 120 }),
      );
    } else if (mood === 'celebrating') {
      headY.value = withRepeat(
        withSequence(
          withTiming(-6, { duration: 280, easing: easeInOut }),
          withTiming(0, { duration: 280, easing: easeInOut }),
        ),
        -1,
        false,
      );
      headRot.value = withTiming(0, { duration: 150 });
      celebrate.value = withTiming(1, { duration: 200 });
    } else if (mood === 'watching') {
      headRot.value = withRepeat(
        withSequence(
          withTiming(-3, { duration: 1200, easing: easeInOut }),
          withTiming(4, { duration: 1200, easing: easeInOut }),
        ),
        -1,
        true,
      );
      headY.value = withTiming(0, { duration: 200 });
      celebrate.value = withTiming(0, { duration: 200 });
    } else {
      headRot.value = withTiming(0, { duration: 250 });
      headY.value = withTiming(0, { duration: 200 });
      celebrate.value = withTiming(0, { duration: 200 });
    }

    // Hiding paws
    if (mood === 'hiding') {
      pawsY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
      pawsOp.value = withTiming(1, { duration: 280 });
      eyesOp.value = withTiming(0, { duration: 120 });
    } else if (mood === 'sleeping') {
      pawsY.value = withTiming(22, { duration: 250 });
      pawsOp.value = withTiming(0, { duration: 200 });
      eyesOp.value = withTiming(0, { duration: 150 });
    } else {
      pawsY.value = withTiming(22, { duration: 300, easing: Easing.out(Easing.cubic) });
      pawsOp.value = withTiming(0, { duration: 250 });
      eyesOp.value = withDelay(80, withTiming(1, { duration: 180 }));
    }
  }, [mood, reduceMotion]);

  const figureStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value }],
  }));

  const tailStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: 18 },
      { translateY: -8 },
      { rotate: `${tail.value * 18}deg` },
    ],
  }));

  const headStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: headY.value },
      { rotate: `${headRot.value}deg` },
    ],
  }));

  const pawsStyle = useAnimatedStyle(() => ({
    opacity: pawsOp.value,
    transform: [{ translateY: pawsY.value }],
  }));

  const eyesStyle = useAnimatedStyle(() => ({
    opacity: eyesOp.value,
  }));

  const pupilOffset = (gaze - 0.5) * 5;

  const fur = colors.isLight ? '#FFFEFB' : '#F5F0E8';
  const furShadow = colors.isLight ? '#E8E2D8' : '#D9D2C6';
  const earInner = '#FFB8C9';
  const mouth = colors.isLight ? 'rgba(26,35,48,0.55)' : 'rgba(26,35,48,0.65)';

  const scale = px / 200;

  return (
    <View
      style={[{ width: px, height: px * 0.92, alignItems: 'center', justifyContent: 'flex-end' }, style]}
      accessible={!decorative}
      accessibilityRole="image"
      accessibilityLabel={decorative ? undefined : catAriaLabel(mood)}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      pointerEvents="none"
    >
      <Animated.View style={[{ width: 200 * scale, height: 180 * scale }, figureStyle]}>
        <View style={{ width: 200, height: 180, transform: [{ scale }] }}>
          {/* Tail */}
          <Animated.View style={[styles.tail, tailStyle, { backgroundColor: furShadow }]}>
            <View style={[styles.tailTip, { backgroundColor: accent }]} />
          </Animated.View>

          {/* Body */}
          <View style={[styles.body, { backgroundColor: fur, borderColor: furShadow }]} />
          <View style={[styles.collar, { backgroundColor: accent }]} />
          <View style={[styles.bell, { backgroundColor: accent }]} />

          {/* Back paws */}
          <View style={[styles.backPaw, styles.backPawL, { backgroundColor: fur }]} />
          <View style={[styles.backPaw, styles.backPawR, { backgroundColor: fur }]} />

          {/* Head */}
          <Animated.View style={[styles.headWrap, headStyle]}>
            <View style={[styles.ear, styles.earL, { backgroundColor: fur }]}>
              <View style={[styles.earInner, { backgroundColor: earInner }]} />
            </View>
            <View style={[styles.ear, styles.earR, { backgroundColor: fur }]}>
              <View style={[styles.earInner, { backgroundColor: earInner }]} />
            </View>
            <View style={[styles.face, { backgroundColor: fur }]}>
              <View style={[styles.cheek, styles.cheekL]} />
              <View style={[styles.cheek, styles.cheekR]} />

              <Animated.View style={[styles.eyesRow, eyesStyle]}>
                <View style={styles.eye}>
                  <View style={[styles.pupil, { transform: [{ translateX: pupilOffset }] }]}>
                    <View style={styles.glint} />
                  </View>
                </View>
                <View style={styles.eye}>
                  <View style={[styles.pupil, { transform: [{ translateX: pupilOffset }] }]}>
                    <View style={styles.glint} />
                  </View>
                </View>
              </Animated.View>

              {/* Closed lids when sleeping/hiding handled by eyesOp */}
              {(mood === 'sleeping' || mood === 'hiding') && (
                <View style={styles.lidsRow} pointerEvents="none">
                  <View style={[styles.lid, { backgroundColor: fur }]} />
                  <View style={[styles.lid, { backgroundColor: fur }]} />
                </View>
              )}

              <View style={styles.nose} />
              <View
                style={[
                  styles.mouth,
                  {
                    borderColor: mouth,
                    borderBottomWidth: mood === 'celebrating' || mood === 'hiding' ? 2.5 : 2,
                    width: mood === 'celebrating' ? 22 : 16,
                    height: mood === 'confused' || mood === 'sad' ? 6 : 8,
                    transform: [
                      {
                        rotate:
                          mood === 'confused' || mood === 'sad' ? '180deg' : '0deg',
                      },
                    ],
                  },
                ]}
              />
            </View>

            {/* Covering paws */}
            <Animated.View style={[styles.pawsCover, pawsStyle]}>
              <View style={[styles.coverPaw, styles.coverPawL, { backgroundColor: fur }]} />
              <View style={[styles.coverPaw, styles.coverPawR, { backgroundColor: fur }]} />
            </Animated.View>
          </Animated.View>

          {/* Front paws */}
          <View style={[styles.frontPaw, styles.frontPawL, { backgroundColor: fur }]} />
          <View style={[styles.frontPaw, styles.frontPawR, { backgroundColor: fur }]} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tail: {
    position: 'absolute',
    right: 28,
    top: 70,
    width: 14,
    height: 56,
    borderRadius: 10,
  },
  tailTip: {
    position: 'absolute',
    top: -4,
    left: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  body: {
    position: 'absolute',
    left: 54,
    top: 92,
    width: 92,
    height: 72,
    borderRadius: 46,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collar: {
    position: 'absolute',
    left: 70,
    top: 108,
    width: 60,
    height: 5,
    borderRadius: 3,
  },
  bell: {
    position: 'absolute',
    left: 94,
    top: 112,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  backPaw: {
    position: 'absolute',
    top: 148,
    width: 28,
    height: 16,
    borderRadius: 10,
  },
  backPawL: { left: 58 },
  backPawR: { right: 58 },
  headWrap: {
    position: 'absolute',
    left: 50,
    top: 18,
    width: 100,
    height: 100,
  },
  ear: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 32,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 4,
    overflow: 'hidden',
  },
  earL: { left: 8, transform: [{ rotate: '-18deg' }] },
  earR: { right: 8, transform: [{ rotate: '18deg' }] },
  earInner: {
    position: 'absolute',
    left: 7,
    top: 8,
    width: 12,
    height: 14,
    borderRadius: 6,
  },
  face: {
    position: 'absolute',
    left: 8,
    top: 14,
    width: 84,
    height: 84,
    borderRadius: 42,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  cheek: {
    position: 'absolute',
    top: 48,
    width: 14,
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(255,184,201,0.4)',
  },
  cheekL: { left: 10 },
  cheekR: { right: 10 },
  eyesRow: {
    position: 'absolute',
    top: 28,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eye: {
    width: 22,
    height: 26,
    borderRadius: 12,
    backgroundColor: '#1A2330',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pupil: {
    width: 11,
    height: 13,
    borderRadius: 6,
    backgroundColor: '#F7C948',
    alignItems: 'flex-start',
    padding: 2,
  },
  glint: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  lidsRow: {
    position: 'absolute',
    top: 28,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lid: {
    width: 22,
    height: 10,
    borderRadius: 6,
  },
  nose: {
    position: 'absolute',
    top: 54,
    left: 36,
    width: 12,
    height: 9,
    borderRadius: 3,
    backgroundColor: '#F48BA0',
  },
  mouth: {
    position: 'absolute',
    top: 62,
    left: 34,
    height: 8,
    width: 16,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    backgroundColor: 'transparent',
  },
  pawsCover: {
    position: 'absolute',
    left: 0,
    top: 28,
    width: 100,
    height: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  coverPaw: {
    width: 40,
    height: 34,
    borderRadius: 18,
  },
  coverPawL: { marginRight: 2 },
  coverPawR: { marginLeft: 2 },
  frontPaw: {
    position: 'absolute',
    top: 142,
    width: 24,
    height: 18,
    borderRadius: 10,
  },
  frontPawL: { left: 70 },
  frontPawR: { right: 70 },
});

export default LumixoCat;
