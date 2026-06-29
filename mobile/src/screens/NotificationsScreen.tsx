// FUTUREHAT mobile — Notification settings: per-category toggles, preview, sound,
// and quiet hours. Standalone; stored in user_preferences.extra.notifications.
// (Push delivery needs FCM — see report; these control in-app behaviour.)
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface NotifSettings {
  messages: boolean; groups: boolean; calls: boolean; reactions: boolean;
  preview: boolean; sound: boolean; quietHours: boolean;
}
const DEFAULTS: NotifSettings = { messages: true, groups: true, calls: true, reactions: true, preview: true, sound: true, quietHours: false };

const ROWS: { key: keyof NotifSettings; label: string; group: string }[] = [
  { key: 'messages', label: 'Direct messages', group: 'NOTIFY ME ABOUT' },
  { key: 'groups', label: 'Group messages', group: 'NOTIFY ME ABOUT' },
  { key: 'calls', label: 'Calls', group: 'NOTIFY ME ABOUT' },
  { key: 'reactions', label: 'Reactions', group: 'NOTIFY ME ABOUT' },
  { key: 'preview', label: 'Message preview', group: 'STYLE' },
  { key: 'sound', label: 'In-app sound', group: 'STYLE' },
  { key: 'quietHours', label: 'Quiet hours (22:00–07:00)', group: 'QUIET HOURS' },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [n, setN] = useState<NotifSettings>(DEFAULTS);

  useEffect(() => {
    getPreferences(supabase).then((p: any) => setN({ ...DEFAULTS, ...((p?.extra && p.extra.notifications) ?? {}) })).catch(() => {});
  }, []);

  async function update(patch: Partial<NotifSettings>) {
    const next = { ...n, ...patch };
    setN(next);
    const prefs: any = await getPreferences(supabase).catch(() => ({}));
    const extra = (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
    await updatePreferences(supabase, { extra: { ...extra, notifications: next } } as any);
  }

  const groups = Array.from(new Set(ROWS.map((r) => r.group)));

  return (
    <ScrollView style={styles.container}>
      {groups.map((g) => (
        <View key={g}>
          <Text style={styles.sectionLabel}>{g}</Text>
          <View style={styles.group}>
            {ROWS.filter((r) => r.group === g).map((r) => (
              <View key={r.key} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Switch value={!!n[r.key]} onValueChange={(v) => update({ [r.key]: v } as Partial<NotifSettings>)} trackColor={{ true: colors.primary, false: colors.border }} />
              </View>
            ))}
          </View>
        </View>
      ))}
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
  });
