/**
 * Lumixo official mascot — "Lumi" (mobile).
 * Completely redesigned premium kitten (View + Reanimated).
 * No react-native-svg dependency. Transform/opacity only for 60 FPS.
 * Respects Reduce Motion. Auth-agnostic: parent passes mood + gaze.
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
  CAT_MOTION,
  CAT_PALETTE as P,
  catAriaLabel,
} from '../../../shared/lumixoCat';

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
  const px = CAT_SIZE_PX[size];

  const breath = useSharedValue(1);
  const tail = useSharedValue(0);
  const headRot = useSharedValue(0);
  const headY = useSharedValue(0);
  const pawsY = useSharedValue(24);
  const pawsOp = useSharedValue(0);
  const eyesOp = useSharedValue(1);
  const sparkleOp = useSharedValue(0);
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
    cancelAnimation(sparkleOp);

    if (reduceMotion) {
      breath.value = 1;
      tail.value = 0;
      headRot.value = mood === 'confused' ? -8 : 0;
      headY.value = 0;
      pawsY.value = mood === 'hiding' ? 0 : 24;
      pawsOp.value = mood === 'hiding' ? 1 : 0;
      eyesOp.value = mood === 'hiding' || mood === 'sleeping' ? 0 : 1;
      celebrate.value = mood === 'celebrating' ? 1 : 0;
      sparkleOp.value = mood === 'celebrating' ? 0.85 : 0;
      return;
    }

    // Breathing — soft idle life
    if (mood === 'idle' || mood === 'watching' || mood === 'sleeping' || mood === 'hiding') {
      breath.value = withRepeat(
        withSequence(
          withTiming(CAT_MOTION.breathScale, { duration: CAT_MOTION.breathMs / 2, easing: easeInOut }),
          withTiming(1, { duration: CAT_MOTION.breathMs / 2, easing: easeInOut }),
        ),
        -1,
        false,
      );
    } else if (mood === 'celebrating') {
      breath.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: CAT_MOTION.celebrateBounceMs / 2, easing: easeInOut }),
          withTiming(1, { duration: CAT_MOTION.celebrateBounceMs / 2, easing: easeInOut }),
        ),
        -1,
        false,
      );
    } else {
      breath.value = withTiming(1, { duration: 200 });
    }

    // Tail sway
    const tailAmp = mood === 'celebrating' ? 1 : mood === 'watching' ? 0.75 : 0.4;
    const tailDur =
      mood === 'celebrating'
        ? CAT_MOTION.tailCelebrateMs
        : mood === 'watching'
          ? CAT_MOTION.tailWatchMs
          : CAT_MOTION.tailSlowMs;
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
        withTiming(-12, { duration: 90 }),
        withTiming(10, { duration: 100 }),
        withTiming(-9, { duration: 90 }),
        withTiming(6, { duration: 90 }),
        withTiming(-6, { duration: 140 }),
      );
      headY.value = withTiming(0, { duration: 150 });
      celebrate.value = withTiming(0, { duration: 150 });
      sparkleOp.value = withTiming(0, { duration: 150 });
    } else if (mood === 'celebrating') {
      headY.value = withRepeat(
        withSequence(
          withTiming(-7, { duration: 280, easing: easeInOut }),
          withTiming(0, { duration: 280, easing: easeInOut }),
        ),
        -1,
        false,
      );
      headRot.value = withTiming(0, { duration: 150 });
      celebrate.value = withTiming(1, { duration: 200 });
      sparkleOp.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 450, easing: easeInOut }),
          withTiming(0.35, { duration: 450, easing: easeInOut }),
        ),
        -1,
        false,
      );
    } else if (mood === 'watching') {
      headRot.value = withRepeat(
        withSequence(
          withTiming(-2.5, { duration: CAT_MOTION.headWatchMs / 2, easing: easeInOut }),
          withTiming(3, { duration: CAT_MOTION.headWatchMs / 2, easing: easeInOut }),
        ),
        -1,
        true,
      );
      headY.value = withTiming(0, { duration: 200 });
      celebrate.value = withTiming(0, { duration: 200 });
      sparkleOp.value = withTiming(0, { duration: 200 });
    } else if (mood === 'wave') {
      headRot.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: 350, easing: easeInOut }),
          withTiming(4, { duration: 350, easing: easeInOut }),
        ),
        -1,
        true,
      );
      headY.value = withTiming(0, { duration: 200 });
      sparkleOp.value = withTiming(0, { duration: 200 });
    } else {
      headRot.value = withTiming(0, { duration: 250 });
      headY.value = withTiming(0, { duration: 200 });
      celebrate.value = withTiming(0, { duration: 200 });
      sparkleOp.value = withTiming(0, { duration: 200 });
    }

    // Hiding paws — fully cover eyes
    if (mood === 'hiding') {
      pawsY.value = withTiming(0, { duration: CAT_MOTION.hideMs, easing: Easing.out(Easing.cubic) });
      pawsOp.value = withTiming(1, { duration: 280 });
      eyesOp.value = withTiming(0, { duration: 110 });
    } else if (mood === 'sleeping') {
      pawsY.value = withTiming(24, { duration: 250 });
      pawsOp.value = withTiming(0, { duration: 200 });
      eyesOp.value = withTiming(0, { duration: 140 });
    } else {
      pawsY.value = withTiming(24, { duration: 300, easing: Easing.out(Easing.cubic) });
      pawsOp.value = withTiming(0, { duration: 240 });
      eyesOp.value = withDelay(70, withTiming(1, { duration: 170 }));
    }
  }, [mood, reduceMotion]);

  const figureStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value }, { translateY: celebrate.value * -2 }],
  }));

  const tailStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: 16 },
      { translateY: -4 },
      { rotate: `${tail.value * 16}deg` },
    ],
  }));

  const headStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headY.value }, { rotate: `${headRot.value}deg` }],
  }));

  const pawsStyle = useAnimatedStyle(() => ({
    opacity: pawsOp.value,
    transform: [{ translateY: pawsY.value }],
  }));

  const eyesStyle = useAnimatedStyle(() => ({
    opacity: eyesOp.value,
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: sparkleOp.value,
  }));

  const pupilOffset = (gaze - 0.5) * 4.2;
  const scale = px / 200;

  const happyMouth = mood === 'celebrating' || mood === 'hiding' || mood === 'wave';
  const sadMouth = mood === 'confused' || mood === 'sad';
  const showBrows = mood === 'confused' || mood === 'sad';
  const sleeping = mood === 'sleeping';

  return (
    <View
      style={[{ width: px, height: px, alignItems: 'center', justifyContent: 'flex-end' }, style]}
      accessible={!decorative}
      accessibilityRole="image"
      accessibilityLabel={decorative ? undefined : catAriaLabel(mood)}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      pointerEvents="none"
    >
      <Animated.View style={[{ width: 200 * scale, height: 200 * scale }, figureStyle]}>
        <View style={{ width: 200, height: 200, transform: [{ scale }] }}>
          {/* Ground shadow */}
          <View style={styles.shadow} />

          {/* Tail */}
          <Animated.View style={[styles.tail, tailStyle]}>
            <View style={[styles.tailSeg, styles.tailBase]} />
            <View style={[styles.tailSeg, styles.tailMid]} />
            <View style={styles.tailTip}>
              <View style={styles.tailTipAccent} />
            </View>
          </Animated.View>

          {/* Body loaf */}
          <View style={styles.body} />
          <View style={styles.chestFluff} />

          {/* Teal collar / scarf */}
          <View style={styles.collar} />
          <View style={styles.collarRibbon} />
          <View style={styles.bell} />

          {/* Side haunches */}
          <View style={[styles.haunch, styles.haunchL]} />
          <View style={[styles.haunch, styles.haunchR]} />

          {/* Head */}
          <Animated.View style={[styles.headWrap, headStyle]}>
            <View style={[styles.ear, styles.earL]}>
              <View style={[styles.earInner, styles.earInnerL]} />
            </View>
            <View style={[styles.ear, styles.earR]}>
              <View style={[styles.earInner, styles.earInnerR]} />
            </View>

            <View style={styles.face}>
              <View style={styles.forehead} />
              <View style={[styles.cheek, styles.cheekL]} />
              <View style={[styles.cheek, styles.cheekR]} />

              {showBrows && (
                <View style={styles.browsRow}>
                  <View style={[styles.brow, styles.browL]} />
                  <View style={[styles.brow, styles.browR]} />
                </View>
              )}

              <Animated.View style={[styles.eyesRow, eyesStyle]}>
                <Eye pupilOffset={pupilOffset} />
                <Eye pupilOffset={pupilOffset} />
              </Animated.View>

              {(sleeping || mood === 'hiding') && (
                <View style={styles.lidsRow} pointerEvents="none">
                  <View style={styles.lid} />
                  <View style={styles.lid} />
                </View>
              )}

              <View style={styles.nose} />
              <View style={styles.noseHighlight} />

              <View
                style={[
                  styles.mouth,
                  happyMouth && styles.mouthHappy,
                  sadMouth && styles.mouthSad,
                ]}
              />
            </View>

            {/* Covering paws */}
            <Animated.View style={[styles.pawsCover, pawsStyle]}>
              <View style={[styles.coverPaw, styles.coverPawL]}>
                <View style={styles.beanRow}>
                  <View style={styles.bean} />
                  <View style={styles.bean} />
                  <View style={styles.bean} />
                </View>
              </View>
              <View style={[styles.coverPaw, styles.coverPawR]}>
                <View style={styles.beanRow}>
                  <View style={styles.bean} />
                  <View style={styles.bean} />
                  <View style={styles.bean} />
                </View>
              </View>
            </Animated.View>
          </Animated.View>

          {/* Front paws */}
          <View style={[styles.frontPaw, styles.frontPawL]} />
          <View style={[styles.frontPaw, styles.frontPawR]} />

          {/* Celebrate sparkles */}
          <Animated.View style={[styles.sparkleWrap, sparkleStyle]} pointerEvents="none">
            <View style={[styles.sparkle, styles.sparkle1]} />
            <View style={[styles.sparkle, styles.sparkle2]} />
            <View style={[styles.sparkle, styles.sparkle3]} />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

/** Single warm amber eye — white sclera, never black void. */
function Eye({ pupilOffset }: { pupilOffset: number }) {
  return (
    <View style={styles.eye}>
      <View style={[styles.iris, { transform: [{ translateX: pupilOffset * 0.55 }] }]}>
        <View style={[styles.pupil, { transform: [{ translateX: pupilOffset * 0.35 }] }]}>
          <View style={styles.glint} />
        </View>
        <View style={styles.glintSm} />
      </View>
    </View>
  );
}

const FUR = P.furTop;
const FUR_MID = P.furMid;
const FUR_SHADOW = P.furShadow;
const EAR_INNER = P.earInner;
const ACCENT = P.accent;
const ACCENT_SOFT = P.accentSoft;

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    left: 54,
    bottom: 10,
    width: 92,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(26,35,48,0.12)',
  },
  tail: {
    position: 'absolute',
    right: 22,
    top: 78,
    width: 44,
    height: 70,
    alignItems: 'center',
  },
  tailSeg: {
    position: 'absolute',
    borderRadius: 10,
    backgroundColor: FUR_SHADOW,
  },
  tailBase: {
    width: 14,
    height: 36,
    bottom: 8,
    borderRadius: 8,
  },
  tailMid: {
    width: 13,
    height: 28,
    top: 8,
    right: 4,
    borderRadius: 8,
    transform: [{ rotate: '18deg' }],
  },
  tailTip: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: FUR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tailTipAccent: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
    opacity: 0.9,
  },
  body: {
    position: 'absolute',
    left: 56,
    top: 108,
    width: 88,
    height: 68,
    borderRadius: 40,
    backgroundColor: FUR_MID,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  chestFluff: {
    position: 'absolute',
    left: 78,
    top: 118,
    width: 44,
    height: 32,
    borderRadius: 20,
    backgroundColor: FUR,
    opacity: 0.7,
  },
  collar: {
    position: 'absolute',
    left: 68,
    top: 118,
    width: 64,
    height: 10,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  collarRibbon: {
    position: 'absolute',
    left: 72,
    top: 124,
    width: 56,
    height: 5,
    borderRadius: 3,
    backgroundColor: ACCENT_SOFT,
    opacity: 0.7,
  },
  bell: {
    position: 'absolute',
    left: 94,
    top: 126,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E8B830',
    borderWidth: 1,
    borderColor: '#C99520',
  },
  haunch: {
    position: 'absolute',
    top: 152,
    width: 30,
    height: 22,
    borderRadius: 12,
    backgroundColor: FUR,
  },
  haunchL: { left: 50 },
  haunchR: { right: 50 },
  headWrap: {
    position: 'absolute',
    left: 48,
    top: 28,
    width: 104,
    height: 100,
  },
  ear: {
    position: 'absolute',
    top: 2,
    width: 26,
    height: 30,
    backgroundColor: FUR,
    overflow: 'hidden',
  },
  earL: {
    left: 10,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 4,
    transform: [{ rotate: '-16deg' }],
  },
  earR: {
    right: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 6,
    transform: [{ rotate: '16deg' }],
  },
  earInner: {
    position: 'absolute',
    top: 8,
    width: 12,
    height: 14,
    borderRadius: 6,
    backgroundColor: EAR_INNER,
  },
  earInnerL: { left: 7 },
  earInnerR: { right: 7 },
  face: {
    position: 'absolute',
    left: 6,
    top: 16,
    width: 92,
    height: 82,
    borderRadius: 42,
    backgroundColor: FUR,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  forehead: {
    position: 'absolute',
    top: 8,
    left: 22,
    width: 48,
    height: 24,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    opacity: 0.35,
  },
  cheek: {
    position: 'absolute',
    top: 48,
    width: 16,
    height: 11,
    borderRadius: 7,
    backgroundColor: 'rgba(255,180,198,0.45)',
  },
  cheekL: { left: 8 },
  cheekR: { right: 8 },
  browsRow: {
    position: 'absolute',
    top: 22,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  brow: {
    width: 16,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(74,52,48,0.35)',
  },
  browL: { transform: [{ rotate: '14deg' }] },
  browR: { transform: [{ rotate: '-14deg' }] },
  eyesRow: {
    position: 'absolute',
    top: 28,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eye: {
    width: 20,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(74,52,48,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iris: {
    width: 13.5,
    height: 14.5,
    borderRadius: 7.5,
    backgroundColor: P.iris,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: {
    width: 5.5,
    height: 6.5,
    borderRadius: 3.5,
    backgroundColor: P.pupil,
    alignItems: 'flex-start',
    paddingTop: 1.2,
    paddingLeft: 0.8,
  },
  glint: {
    width: 3.2,
    height: 3.2,
    borderRadius: 1.6,
    backgroundColor: '#fff',
  },
  glintSm: {
    position: 'absolute',
    right: 2,
    bottom: 3,
    width: 1.8,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: '#fff',
    opacity: 0.6,
  },
  lidsRow: {
    position: 'absolute',
    top: 28,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lid: {
    width: 22,
    height: 10,
    borderRadius: 6,
    backgroundColor: FUR_MID,
  },
  nose: {
    position: 'absolute',
    top: 52,
    left: 40,
    width: 12,
    height: 9,
    borderRadius: 5,
    backgroundColor: P.nose,
  },
  noseHighlight: {
    position: 'absolute',
    top: 53.5,
    left: 43,
    width: 5,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFD0DC',
    opacity: 0.75,
  },
  mouth: {
    position: 'absolute',
    top: 62,
    left: 36,
    width: 20,
    height: 8,
    borderBottomWidth: 1.8,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: 'rgba(74,52,48,0.5)',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    backgroundColor: 'transparent',
  },
  mouthHappy: {
    width: 24,
    left: 34,
    height: 10,
    borderBottomWidth: 2.2,
  },
  mouthSad: {
    transform: [{ rotate: '180deg' }],
    top: 66,
    height: 6,
  },
  pawsCover: {
    position: 'absolute',
    left: 4,
    top: 30,
    width: 96,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 2,
  },
  coverPaw: {
    width: 38,
    height: 32,
    borderRadius: 16,
    backgroundColor: FUR,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  coverPawL: {},
  coverPawR: {},
  beanRow: {
    flexDirection: 'row',
    gap: 3,
  },
  bean: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: EAR_INNER,
    opacity: 0.55,
  },
  frontPaw: {
    position: 'absolute',
    top: 158,
    width: 22,
    height: 16,
    borderRadius: 9,
    backgroundColor: FUR,
  },
  frontPawL: { left: 72 },
  frontPawR: { right: 72 },
  sparkleWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  sparkle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: ACCENT_SOFT,
    transform: [{ rotate: '45deg' }],
  },
  sparkle1: { top: 36, left: 36 },
  sparkle2: { top: 28, right: 40, width: 6, height: 6, backgroundColor: ACCENT },
  sparkle3: { top: 80, right: 28, width: 5, height: 5, backgroundColor: '#FFE08A' },
});

export default LumixoCat;
