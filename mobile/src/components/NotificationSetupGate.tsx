/**
 * Full-screen first-launch notification setup.
 * Flow: rationale → system permission → (optional) Battery Assistant → done.
 * Never nags after dismiss; permanent deny offers Settings.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors, spacing, radius, font, type Palette } from '../theme';
import {
  NOTIF_RATIONALE,
  dismissBatteryGuide,
  dismissOemGuide,
  getPermissionState,
  markNotificationSetupDone,
  openAppNotificationSettings,
  requestNotificationPermissionFromUser,
  shouldShowNotificationSetup,
  type NotifPermissionState,
} from '../lib/notificationSetup';
import { shouldShowBatteryAssistant } from '../lib/batteryAssistant';
import { initNotifications, registerForPush } from '../lib/notifications';
import BatteryAssistant from './BatteryAssistant';

type Step = 'loading' | 'rationale' | 'denied' | 'battery' | 'hidden';

export default function NotificationSetupGate() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<Step>('loading');
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<NotifPermissionState>('undetermined');

  const finishOrNextGuides = useCallback(async () => {
    await markNotificationSetupDone();
    // Dismiss legacy OEM/battery keys so old flags don't re-fire after upgrade.
    await dismissOemGuide();
    if (await shouldShowBatteryAssistant()) {
      setStep('battery');
      return;
    }
    await dismissBatteryGuide();
    setStep('hidden');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await initNotifications().catch(() => {});
      const show = await shouldShowNotificationSetup();
      const state = await getPermissionState();
      if (!alive) return;
      setPerm(state);
      if (!show && state === 'granted') {
        void registerForPush();
        if (await shouldShowBatteryAssistant()) {
          setStep('battery');
          return;
        }
        setStep('hidden');
        return;
      }
      if (state === 'granted') {
        void registerForPush();
        await finishOrNextGuides();
        return;
      }
      if (state === 'denied_permanent') {
        setStep('denied');
        return;
      }
      setStep('rationale');
    })();
    return () => {
      alive = false;
    };
  }, [finishOrNextGuides]);

  async function onAllow() {
    setBusy(true);
    try {
      const next = await requestNotificationPermissionFromUser();
      setPerm(next);
      if (next === 'granted') {
        await finishOrNextGuides();
      } else {
        setStep('denied');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSkipRationale() {
    await markNotificationSetupDone();
    if (await shouldShowBatteryAssistant()) setStep('battery');
    else setStep('hidden');
  }

  async function onRetry() {
    if (perm === 'denied_permanent') {
      await openAppNotificationSettings();
      setTimeout(async () => {
        const s = await getPermissionState();
        setPerm(s);
        if (s === 'granted') {
          await registerForPush();
          await finishOrNextGuides();
        }
      }, 800);
      return;
    }
    await onAllow();
  }

  async function onBatteryAssistantClose() {
    await dismissBatteryGuide();
    await dismissOemGuide();
    setStep('hidden');
  }

  if (step === 'loading' || step === 'hidden') return null;

  // Interactive battery assistant (separate modal — Material, auto status check).
  if (step === 'battery') {
    return <BatteryAssistant visible onClose={() => void onBatteryAssistantClose()} />;
  }

  return (
    <Modal visible animationType="fade" transparent={false} statusBarTranslucent>
      <View
        style={[
          styles.root,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            backgroundColor: colors.bg,
          },
        ]}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 'rationale' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="notifications" size={40} color={colors.primary} />
              </View>
              <Text style={styles.title}>{NOTIF_RATIONALE.title}</Text>
              <Text style={styles.body}>{NOTIF_RATIONALE.body}</Text>
              {NOTIF_RATIONALE.bullets.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
              <Pressable
                style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                onPress={onAllow}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>Continue</Text>
                )}
              </Pressable>
              <Text style={styles.hint}>Next: the system will ask for permission.</Text>
              <Pressable onPress={onSkipRationale} hitSlop={12}>
                <Text style={styles.secondaryLink}>Not now</Text>
              </Pressable>
            </>
          )}

          {step === 'denied' && (
            <>
              <View style={[styles.iconWrap, { backgroundColor: colors.danger + '22' }]}>
                <Ionicons name="notifications-off" size={40} color={colors.danger} />
              </View>
              <Text style={styles.title}>Notifications are off</Text>
              <Text style={styles.body}>
                {perm === 'denied_permanent'
                  ? 'Permission was permanently denied. Open Settings, enable Notifications for Lumixo, then return here.'
                  : 'Without notifications you will not hear new messages or calls when Lumixo is closed.'}
              </Text>
              <Pressable style={styles.primaryBtn} onPress={onRetry} disabled={busy}>
                <Text style={styles.primaryText}>
                  {perm === 'denied_permanent' ? 'Open Settings' : 'Grant permission'}
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await markNotificationSetupDone();
                  await finishOrNextGuides();
                }}
                hitSlop={12}
              >
                <Text style={styles.secondaryLink}>Continue without notifications</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing(6),
      justifyContent: 'center',
      paddingVertical: spacing(4),
    },
    iconWrap: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: spacing(4),
    },
    badge: {
      alignSelf: 'center',
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '700',
      marginBottom: spacing(1),
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '800',
      textAlign: 'center',
      letterSpacing: -0.3,
      marginBottom: spacing(2),
    },
    body: {
      color: colors.textMuted,
      fontSize: font.body,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: spacing(4),
    },
    bulletRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing(2.5),
      marginBottom: spacing(2.5),
      paddingHorizontal: spacing(1),
    },
    bulletText: { flex: 1, color: colors.text, fontSize: font.body, lineHeight: 21 },
    stepNum: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary + '22',
      color: colors.primary,
      textAlign: 'center',
      lineHeight: 24,
      fontWeight: '800',
      fontSize: 12,
      overflow: 'hidden',
    },
    primaryBtn: {
      marginTop: spacing(4),
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    hint: {
      color: colors.textFaint,
      fontSize: font.tiny,
      textAlign: 'center',
      marginTop: spacing(2),
    },
    secondaryLink: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: spacing(4),
    },
  });
