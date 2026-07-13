/**
 * Interactive battery / background-activity assistant.
 * - Manufacturer-aware, never forces settings changes
 * - Auto-checks status when returning from Settings
 * - Success animation → auto-dismiss; soft decline if skipped
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, spacing, radius, font, motion, type Palette } from '../theme';
import {
  BATTERY_SOFT_DECLINE_COPY,
  BATTERY_SUCCESS_COPY,
  BATTERY_WHY_COPY,
  getBatteryAssistStatus,
  markBatteryAssistantSeen,
  markBatteryAssistantSuccess,
  openBatteryAssistantSettings,
  setBatteryAssistantNeverAsk,
  setBatteryAssistantRemindLater,
  watchBatteryStatusOnResume,
  type BatteryAssistStatus,
} from '../lib/batteryAssistant';

export type BatteryAssistantProps = {
  visible: boolean;
  /** When true, show even if never-ask / non-aggressive OEM (Settings entry). */
  force?: boolean;
  onClose: () => void;
};

type Phase = 'assist' | 'success' | 'soft';

export default function BatteryAssistant({ visible, force, onClose }: BatteryAssistantProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [status, setStatus] = useState<BatteryAssistStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('assist');
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const closedRef = useRef(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkScale = useRef(new Animated.Value(0.4)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (successTimer.current) clearTimeout(successTimer.current);
    onClose();
  }, [onClose]);

  // Load status when opened; reset phase.
  useEffect(() => {
    if (!visible) {
      closedRef.current = false;
      setPhase('assist');
      setAwaitingReturn(false);
      checkScale.setValue(0.4);
      checkOpacity.setValue(0);
      contentOpacity.setValue(1);
      return;
    }
    closedRef.current = false;
    void markBatteryAssistantSeen();
    void getBatteryAssistStatus().then((s) => {
      setStatus(s);
      if (s.statusKnown && s.backgroundAllowed) {
        setPhase('success');
      } else {
        setPhase('assist');
      }
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
  }, [visible, checkOpacity, checkScale, contentOpacity]);

  // Play success animation + auto-close.
  useEffect(() => {
    if (!visible || phase !== 'success') return;
    void markBatteryAssistantSuccess();

    if (reduceMotion) {
      checkOpacity.setValue(1);
      checkScale.setValue(1);
    } else {
      Animated.parallel([
        Animated.spring(checkScale, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
        Animated.timing(checkOpacity, {
          toValue: 1,
          duration: motion.openMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }

    successTimer.current = setTimeout(() => finish(), 2600);
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [visible, phase, reduceMotion, checkOpacity, checkScale, finish]);

  // Auto-check when user returns from system settings.
  useEffect(() => {
    if (!visible || !awaitingReturn) return;
    return watchBatteryStatusOnResume({
      onAllowed: (s) => {
        setStatus(s);
        setAwaitingReturn(false);
        setPhase('success');
      },
      onStillRestricted: (s) => {
        setStatus(s);
        setAwaitingReturn(false);
        setPhase('soft');
      },
      onUnknown: (s) => {
        // Cannot read OS status (OEM) — show soft complete, never nag.
        setStatus(s);
        setAwaitingReturn(false);
        setPhase('soft');
      },
    });
  }, [visible, awaitingReturn]);

  async function onOpenSettings() {
    setAwaitingReturn(true);
    const ok = await openBatteryAssistantSettings();
    if (!ok) {
      // Could not open anything — soft exit without trapping the user.
      setAwaitingReturn(false);
      setPhase('soft');
    }
  }

  async function onContinueSoft() {
    finish();
  }

  async function onRemindLater() {
    await setBatteryAssistantRemindLater();
    finish();
  }

  async function onDontAskAgain() {
    await setBatteryAssistantNeverAsk();
    finish();
  }

  if (!visible) return null;

  const brand = status?.guide.brandLabel ?? 'Android';
  const showBrand = status ? status.family !== 'other' && status.family !== 'ios' : true;

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={() => {
        // Back: soft complete, never force
        if (phase === 'assist') setPhase('soft');
        else finish();
      }}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Animated.View style={[styles.card, { opacity: contentOpacity }]}>
          {phase === 'success' && (
            <View style={styles.phaseWrap} accessibilityRole="summary">
              <Animated.View
                style={[
                  styles.successRing,
                  {
                    backgroundColor: colors.primary + '22',
                    opacity: checkOpacity,
                    transform: [{ scale: checkScale }],
                  },
                ]}
              >
                <Ionicons name="checkmark-circle" size={56} color={colors.primary} />
              </Animated.View>
              <Text style={styles.title}>{BATTERY_SUCCESS_COPY.title}</Text>
              <Text style={styles.body}>{BATTERY_SUCCESS_COPY.body}</Text>
              <Text style={styles.hint}>Closing…</Text>
            </View>
          )}

          {phase === 'soft' && (
            <View style={styles.phaseWrap}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="shield-checkmark-outline" size={36} color={colors.textMuted} />
              </View>
              <Text style={styles.title}>{BATTERY_SOFT_DECLINE_COPY.title}</Text>
              <Text style={styles.body}>{BATTERY_SOFT_DECLINE_COPY.body}</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => void onContinueSoft()}
                accessibilityRole="button"
                accessibilityLabel="Continue"
              >
                <Text style={styles.primaryText}>Continue</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => void onRemindLater()}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Remind me later</Text>
              </Pressable>
              {!force && (
                <Pressable onPress={() => void onDontAskAgain()} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.tertiaryLink}>Don&apos;t ask again</Text>
                </Pressable>
              )}
            </View>
          )}

          {phase === 'assist' && (
            <View style={styles.phaseWrap}>
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="battery-charging" size={36} color={colors.primary} />
              </View>
              {showBrand && (
                <View style={[styles.chip, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons name="phone-portrait-outline" size={14} color={colors.primary} />
                  <Text style={[styles.chipText, { color: colors.primary }]}>{brand}</Text>
                </View>
              )}
              <Text style={styles.title}>Keep calls &amp; alerts reliable</Text>
              <Text style={styles.body}>{BATTERY_WHY_COPY}</Text>
              {status?.guide?.body ? (
                <Text style={styles.oemNote}>{status.guide.body}</Text>
              ) : null}

              <Pressable
                style={styles.primaryBtn}
                onPress={() => void onOpenSettings()}
                accessibilityRole="button"
                accessibilityLabel="Open Settings"
              >
                <Ionicons name="settings-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryText}>Open Settings</Text>
              </Pressable>

              {awaitingReturn ? (
                <Text style={styles.hint}>Return here after changing the setting — we&apos;ll check automatically.</Text>
              ) : (
                <Pressable
                  onPress={() => setPhase('soft')}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Not now"
                >
                  <Text style={styles.tertiaryLink}>Not now</Text>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      paddingHorizontal: spacing(4),
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl ?? 20,
      paddingHorizontal: spacing(5),
      paddingVertical: spacing(6),
      maxWidth: 440,
      width: '100%',
      alignSelf: 'center',
      // elevation
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
    phaseWrap: {
      alignItems: 'center',
    },
    iconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(3),
    },
    successRing: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(3),
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
      marginBottom: spacing(2),
    },
    chipText: {
      fontSize: font.small,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '800',
      textAlign: 'center',
      letterSpacing: -0.3,
      marginBottom: spacing(2),
      paddingHorizontal: spacing(1),
    },
    body: {
      color: colors.textMuted,
      fontSize: font.body,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: spacing(3),
    },
    oemNote: {
      color: colors.textFaint,
      fontSize: font.small,
      lineHeight: 18,
      textAlign: 'center',
      marginBottom: spacing(3),
      paddingHorizontal: spacing(1),
    },
    primaryBtn: {
      marginTop: spacing(2),
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      minHeight: 52,
      paddingHorizontal: spacing(5),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
    },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    secondaryBtn: {
      marginTop: spacing(2),
      borderRadius: radius.pill,
      minHeight: 48,
      paddingHorizontal: spacing(5),
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.surfaceAlt,
    },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    tertiaryLink: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: spacing(3),
    },
    hint: {
      color: colors.textFaint,
      fontSize: font.tiny,
      textAlign: 'center',
      marginTop: spacing(3),
      lineHeight: 16,
      paddingHorizontal: spacing(2),
    },
  });
