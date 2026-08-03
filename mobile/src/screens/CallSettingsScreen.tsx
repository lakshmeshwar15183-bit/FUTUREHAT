// Lumixo mobile — Call Settings (flagship polish).
// Prefs in user_preferences.extra.calls + deep links to system mic/camera.
import React, { useCallback, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCallSettings, setCallSettings, DEFAULT_CALL_SETTINGS } from '../lib/shared';
import type { CallSettings } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    /* ignore */
  }
}

export default function CallSettingsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const [s, setS] = useState<CallSettings>(DEFAULT_CALL_SETTINGS);

  useFocusEffect(
    useCallback(() => {
      getCache<CallSettings | null>('callSettings', null).then((c) => {
        if (c) setS({ ...DEFAULT_CALL_SETTINGS, ...c });
      });
      getCallSettings(supabase)
        .then((next) => {
          setS(next);
          setCache('callSettings', next);
        })
        .catch(() => {});
    }, []),
  );

  const update = (patch: Partial<CallSettings>) => {
    setS((cur) => {
      const next = { ...cur, ...patch };
      setCache('callSettings', next);
      return next;
    });
    setCallSettings(supabase, patch).catch(() => {});
  };

  return (
    <SafeScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing(10) }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>INCOMING</Text>
      <View style={styles.group}>
        <ToggleRow
          icon="notifications-off-outline"
          label="Silence unknown callers"
          sub="Silence calls from people you don't share a chat with"
          value={s.silence_unknown}
          onChange={(v) => update({ silence_unknown: v })}
          colors={colors}
          styles={styles}
        />
        <ToggleRow
          icon="musical-notes-outline"
          label="Ringtone"
          sub="Play a ringtone on incoming calls"
          value={s.ringtone}
          onChange={(v) => update({ ringtone: v })}
          colors={colors}
          styles={styles}
        />
        <ToggleRow
          icon="phone-portrait-outline"
          label="Vibrate"
          sub="Vibrate on incoming calls"
          value={s.vibrate}
          onChange={(v) => update({ vibrate: v })}
          colors={colors}
          styles={styles}
          last
        />
      </View>

      <Text style={styles.sectionLabel}>AUDIO QUALITY</Text>
      <View style={styles.group}>
        <ToggleRow
          icon="mic-outline"
          label="Noise suppression"
          sub="Reduce background noise when supported"
          value={s.noise_suppression !== false}
          onChange={(v) => update({ noise_suppression: v })}
          colors={colors}
          styles={styles}
        />
        <ToggleRow
          icon="volume-high-outline"
          label="Echo cancellation"
          sub="Reduce echo / feedback when supported"
          value={s.echo_cancellation !== false}
          onChange={(v) => update({ echo_cancellation: v })}
          colors={colors}
          styles={styles}
          last
        />
      </View>

      <Text style={styles.sectionLabel}>DEVICE</Text>
      <View style={styles.group}>
        <LinkRow
          icon="camera-outline"
          label="Camera permission"
          sub="System camera access for video calls"
          onPress={openAppSettings}
          colors={colors}
          styles={styles}
        />
        <LinkRow
          icon="mic-outline"
          label="Microphone permission"
          sub="System microphone access for calls"
          onPress={openAppSettings}
          colors={colors}
          styles={styles}
        />
        <LinkRow
          icon="bluetooth-outline"
          label="Bluetooth"
          sub={
            Platform.OS === 'android'
              ? 'Pair headsets in system Bluetooth settings'
              : 'Pair headsets in iOS Settings → Bluetooth'
          }
          onPress={openAppSettings}
          colors={colors}
          styles={styles}
          last
        />
      </View>

      <Pressable
        style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: colors.surfaceAlt }]}
        onPress={() => navigation.navigate('Notifications')}
        accessibilityRole="button"
        accessibilityLabel="Notification settings"
      >
        <Ionicons name="notifications-outline" size={22} color={colors.textMuted} />
        <Text style={styles.linkLabel}>Notification settings</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <Text style={styles.note}>
        Call preferences save to your account. Noise suppression and echo cancellation are applied when the
        device and WebRTC stack support them.
      </Text>
    </SafeScrollView>
  );
}

function ToggleRow({
  icon,
  label,
  sub,
  value,
  onChange,
  colors,
  styles,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: Palette;
  styles: Styles;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} maxFontSizeMultiplier={1.4}>
          {label}
        </Text>
        <Text style={styles.rowSub} maxFontSizeMultiplier={1.35}>
          {sub}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        accessibilityLabel={label}
      />
    </View>
  );
}

function LinkRow({
  icon,
  label,
  sub,
  onPress,
  colors,
  styles,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  colors: Palette;
  styles: Styles;
  last?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && { backgroundColor: colors.surfaceAlt }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={sub}
    >
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="open-outline" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: spacing(5),
      marginBottom: spacing(1.5),
      marginHorizontal: spacing(5),
    },
    group: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      marginHorizontal: spacing(3),
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      minHeight: 56,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowBody: { flex: 1, marginLeft: spacing(4), marginRight: spacing(2) },
    rowLabel: { color: colors.text, fontSize: font.body, fontWeight: '500' },
    rowSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2, lineHeight: 16 },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      marginHorizontal: spacing(3),
      marginTop: spacing(3),
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      minHeight: 52,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
    },
    linkLabel: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(4), fontWeight: '500' },
    note: {
      color: colors.textFaint,
      fontSize: font.tiny,
      textAlign: 'center',
      paddingHorizontal: spacing(6),
      marginTop: spacing(4),
      lineHeight: 16,
    },
  });
