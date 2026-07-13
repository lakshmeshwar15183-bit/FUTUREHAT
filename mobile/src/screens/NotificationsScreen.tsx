// Lumixo mobile — Notification settings (WhatsApp layout). Grouped MESSAGE /
// CALLS / STATUS / GROUPS sections stored in user_preferences.extra.notifications
// (synced to the profile → restore on any device). Notification tone / ringtone
// use the DEVICE SYSTEM DEFAULT sound; the tone rows open Android's per-channel
// settings for native customization (no bundled sounds, no in-app picker).
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Alert } from '../ui/dialog';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getNotificationSettings, setNotificationSettings, toneLabel,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '../lib/shared';
import type { NotificationSettings } from '../lib/shared';
import {
  CHANNELS,
  getNotificationPermissionGranted,
  openNotificationSystemSettings,
  registerForPush,
} from '../lib/notifications';
import { detectOemFamily, getOemGuide } from '../lib/notificationSetup';
import {
  getBatteryAssistStatus,
  resetBatteryAssistantForManualOpen,
} from '../lib/batteryAssistant';
import BatteryAssistant from '../components/BatteryAssistant';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';

// Open Android's per-channel notification settings (native sound/vibration/LED).
// iOS has no notification channels, so fall through to the app's system settings
// (where Notifications live) rather than dead-ending on the tone row.
async function openChannelSettings(channelId: string) {
  if (Platform.OS !== 'android') {
    try { await Linking.openSettings(); } catch { /* ignore */ }
    return;
  }
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'dev.lakshmeshwar.futurehat' },
      { key: 'android.provider.extra.CHANNEL_ID', value: channelId },
    ]);
  } catch {
    try { await Linking.openSettings(); } catch { /* ignore */ }
  }
}

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const oem = useMemo(() => getOemGuide(detectOemFamily()), []);
  const [n, setN] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [osGranted, setOsGranted] = useState<boolean | null>(null);
  const [batteryAllowed, setBatteryAllowed] = useState<boolean | null>(null);
  const [batteryKnown, setBatteryKnown] = useState(false);
  const [showBatteryAssist, setShowBatteryAssist] = useState(false);

  const refreshBattery = useCallback(() => {
    if (Platform.OS !== 'android') return;
    getBatteryAssistStatus()
      .then((s) => {
        setBatteryKnown(s.statusKnown);
        setBatteryAllowed(s.statusKnown ? s.backgroundAllowed : null);
      })
      .catch(() => {
        setBatteryKnown(false);
        setBatteryAllowed(null);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      getCache<NotificationSettings | null>('notifsV2', null).then((c) => { if (c) setN({ ...DEFAULT_NOTIFICATION_SETTINGS, ...c }); });
      getNotificationSettings(supabase).then((s) => { setN(s); setCache('notifsV2', s); }).catch(() => {});
      getNotificationPermissionGranted().then(setOsGranted).catch(() => setOsGranted(null));
      refreshBattery();
    }, [refreshBattery]),
  );

  function update(patch: Partial<NotificationSettings>) {
    const next = { ...n, ...patch };
    setN(next);
    setCache('notifsV2', next);
    setNotificationSettings(supabase, patch).catch(() => {});
  }

  const Toggle = ({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: spacing(3) }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {desc ? <Text style={styles.rowDesc}>{desc}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );

  const ToneRow = ({ label, value, channel }: { label: string; value: string; channel: string }) => (
    <Pressable style={styles.row} onPress={() => openChannelSettings(channel)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{toneLabel(value)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );

  return (
    <ScrollView style={styles.container}>
      {/* SYSTEM — required for killed-app delivery */}
      <Text style={styles.sectionLabel}>SYSTEM</Text>
      <View style={styles.group}>
        <Pressable
          style={styles.row}
          onPress={async () => {
            const ok = await registerForPush();
            setOsGranted(ok);
            if (!ok) {
              Alert.alert(
                'Notifications off',
                'Allow notifications so you still get messages when Lumixo is closed.',
                [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Open settings', onPress: () => void openNotificationSystemSettings() },
                ],
              );
            }
          }}
        >
          <View style={{ flex: 1, marginRight: spacing(3) }}>
            <Text style={styles.rowLabel}>Notification permission</Text>
            <Text style={styles.rowDesc}>
              {osGranted === null
                ? 'Checking…'
                : osGranted
                  ? 'Allowed — messages can arrive when the app is closed'
                  : 'Denied — tap to allow or open system settings'}
            </Text>
          </View>
          <Ionicons
            name={osGranted ? 'checkmark-circle' : 'alert-circle-outline'}
            size={22}
            color={osGranted ? colors.primary : colors.danger}
          />
        </Pressable>
        {Platform.OS === 'android' && (
          <Pressable
            style={styles.row}
            onPress={() => {
              void resetBatteryAssistantForManualOpen();
              setShowBatteryAssist(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Battery optimization assistant"
          >
            <View style={{ flex: 1, marginRight: spacing(3) }}>
              <Text style={styles.rowLabel}>Battery optimization</Text>
              <Text style={styles.rowDesc}>
                {batteryKnown && batteryAllowed
                  ? 'Background activity enabled — calls & alerts should be reliable'
                  : batteryKnown && batteryAllowed === false
                    ? `${oem.brandLabel}: tap for a guided fix (recommended)`
                    : 'Improve call & notification delivery when the app is closed'}
              </Text>
            </View>
            <Ionicons
              name={batteryKnown && batteryAllowed ? 'checkmark-circle' : 'chevron-forward'}
              size={batteryKnown && batteryAllowed ? 22 : 16}
              color={batteryKnown && batteryAllowed ? colors.primary : colors.textFaint}
            />
          </Pressable>
        )}
      </View>

      <BatteryAssistant
        visible={showBatteryAssist}
        force
        onClose={() => {
          setShowBatteryAssist(false);
          refreshBattery();
        }}
      />

      {/* MESSAGE */}
      <Text style={styles.sectionLabel}>MESSAGE</Text>
      <View style={styles.group}>
        <Toggle label="Mute" desc="Silence direct-message notifications" value={n.messageMute} onChange={(v) => update({ messageMute: v })} />
        <ToneRow label="Notification tone" value={n.messageTone} channel={CHANNELS.messages} />
        <Toggle label="Vibrate" value={n.messageVibrate} onChange={(v) => update({ messageVibrate: v })} />
        <Toggle label="Popup" desc="Show a heads-up banner" value={n.messagePopup} onChange={(v) => update({ messagePopup: v })} />
        <Toggle label="High priority" desc="Show previews at the top of the screen" value={n.messageHighPriority} onChange={(v) => update({ messageHighPriority: v })} />
        <Toggle label="Notification preview" desc="Show message text in the notification" value={n.messagePreview} onChange={(v) => update({ messagePreview: v })} />
      </View>

      {/* CALLS */}
      <Text style={styles.sectionLabel}>CALLS</Text>
      <View style={styles.group}>
        <ToneRow label="Ringtone" value={n.callRingtone} channel={CHANNELS.calls} />
        <Toggle label="Vibrate" value={n.callVibrate} onChange={(v) => update({ callVibrate: v })} />
        <Toggle label="Full screen incoming calls" desc="Show a full-screen ringing UI" value={n.callFullScreen} onChange={(v) => update({ callFullScreen: v })} />
        <Toggle label="Flash screen" desc="Flash on incoming call (optional)" value={n.callFlash} onChange={(v) => update({ callFlash: v })} />
      </View>

      {/* STATUS */}
      <Text style={styles.sectionLabel}>STATUS</Text>
      <View style={styles.group}>
        <Toggle label="Mute status notifications" value={n.statusMute} onChange={(v) => update({ statusMute: v })} />
      </View>

      {/* GROUPS */}
      <Text style={styles.sectionLabel}>GROUPS</Text>
      <View style={styles.group}>
        <Toggle label="Mute" desc="Silence group-message notifications" value={n.groupMute} onChange={(v) => update({ groupMute: v })} />
        <ToneRow label="Notification tone" value={n.groupTone} channel={CHANNELS.groups} />
        <Toggle label="Vibrate" value={n.groupVibrate} onChange={(v) => update({ groupVibrate: v })} />
      </View>

      <Text style={styles.footnote}>
        Notification tones use your device’s default sound. Tap a tone to customize its sound,
        vibration and light in Android settings. Preferences sync to your account.
      </Text>
      <View style={{ height: spacing(8) }} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', marginTop: spacing(5), marginBottom: spacing(2), marginHorizontal: spacing(4), letterSpacing: 0.5 },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), borderRadius: radius.md, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
    rowDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    footnote: { color: colors.textFaint, fontSize: font.tiny, marginHorizontal: spacing(4), marginTop: spacing(4), lineHeight: 16 },
  });
