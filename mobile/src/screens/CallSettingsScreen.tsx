// FUTUREHAT mobile — Call Settings. A few persisted call preferences (stored in
// user_preferences.extra.calls via callSettingsApi) plus a link to Notifications.
// Reached from the Calls overflow menu.
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCallSettings, setCallSettings, DEFAULT_CALL_SETTINGS } from '../lib/shared';
import type { CallSettings } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CallSettingsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const [s, setS] = useState<CallSettings>(DEFAULT_CALL_SETTINGS);

  useFocusEffect(useCallback(() => {
    getCallSettings(supabase).then(setS).catch(() => {});
  }, []));

  const update = (patch: Partial<CallSettings>) => {
    setS((cur) => ({ ...cur, ...patch }));        // instant
    setCallSettings(supabase, patch).catch(() => {});
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.group}>
        <ToggleRow
          icon="notifications-off-outline" label="Silence unknown callers"
          sub="Silence calls from people you don't share a chat with"
          value={s.silence_unknown} onChange={(v) => update({ silence_unknown: v })} colors={colors} styles={styles}
        />
        <ToggleRow
          icon="musical-notes-outline" label="Ringtone"
          sub="Play a ringtone on incoming calls"
          value={s.ringtone} onChange={(v) => update({ ringtone: v })} colors={colors} styles={styles}
        />
        <ToggleRow
          icon="phone-portrait-outline" label="Vibrate"
          sub="Vibrate on incoming calls"
          value={s.vibrate} onChange={(v) => update({ vibrate: v })} colors={colors} styles={styles}
        />
      </View>

      <Pressable style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: colors.surfaceAlt }]} onPress={() => navigation.navigate('Notifications')}>
        <Ionicons name="notifications-outline" size={22} color={colors.textMuted} />
        <Text style={styles.linkLabel}>Notification settings</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <Text style={styles.note}>Call preferences are saved to your account and apply on this and your other devices.</Text>
    </ScrollView>
  );
}

function ToggleRow({ icon, label, sub, value, onChange, colors, styles }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub: string;
  value: boolean; onChange: (v: boolean) => void; colors: Palette; styles: Styles;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    group: { backgroundColor: colors.surface, borderRadius: radius.md, margin: spacing(3), overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
    rowBody: { flex: 1, marginLeft: spacing(4), marginRight: spacing(2) },
    rowLabel: { color: colors.text, fontSize: font.body },
    rowSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2 },
    linkRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, marginHorizontal: spacing(3), paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
    linkLabel: { flex: 1, color: colors.text, fontSize: font.body, marginLeft: spacing(4) },
    note: { color: colors.textFaint, fontSize: font.tiny, textAlign: 'center', paddingHorizontal: spacing(6), marginTop: spacing(4) },
  });
