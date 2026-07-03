// FUTUREHAT mobile — Notification settings: per-category toggles, preview, sound,
// and quiet hours with a custom From/To time window. Standalone; stored in
// user_preferences.extra.notifications.
// (Push delivery needs FCM — see report; these control in-app behaviour.)
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import InputModal from '../components/InputModal';

interface NotifSettings {
  messages: boolean; groups: boolean; calls: boolean; reactions: boolean;
  preview: boolean; sound: boolean;
  quietHours: boolean; quietFrom: string; quietTo: string;
}
const DEFAULTS: NotifSettings = {
  messages: true, groups: true, calls: true, reactions: true,
  preview: true, sound: true, quietHours: false, quietFrom: '22:00', quietTo: '07:00',
};

const TOGGLE_ROWS: { key: keyof NotifSettings; label: string; group: string }[] = [
  { key: 'messages', label: 'Direct messages', group: 'NOTIFY ME ABOUT' },
  { key: 'groups', label: 'Group messages', group: 'NOTIFY ME ABOUT' },
  { key: 'calls', label: 'Calls', group: 'NOTIFY ME ABOUT' },
  { key: 'reactions', label: 'Reactions', group: 'NOTIFY ME ABOUT' },
  { key: 'preview', label: 'Message preview', group: 'STYLE' },
  { key: 'sound', label: 'In-app sound', group: 'STYLE' },
];

// Normalise free-form input to a 24h HH:MM string, or null if unparseable.
function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [n, setN] = useState<NotifSettings>(DEFAULTS);
  const [editWindow, setEditWindow] = useState(false);

  useEffect(() => {
    // Instant: cached notification settings first (offline included), then refresh.
    getCache<NotifSettings | null>('notifs', null).then((c) => { if (c) setN({ ...DEFAULTS, ...c }); });
    getPreferences(supabase)
      .then((p: any) => {
        const merged = { ...DEFAULTS, ...((p?.extra && p.extra.notifications) ?? {}) };
        setN(merged);
        setCache('notifs', merged);
      })
      .catch(() => {});
  }, []);

  async function update(patch: Partial<NotifSettings>) {
    const next = { ...n, ...patch };
    setN(next);               // instant UI
    setCache('notifs', next); // instant local persistence (offline included)
    // Merge into the existing prefs.extra (which also holds chat settings) so we
    // never clobber sibling keys, then write. The UI already updated above, so a
    // slow / failed network never blocks it.
    const prefs: any = await getPreferences(supabase).catch(() => null);
    if (!prefs) return; // couldn't read current extra — skip to avoid clobbering
    const extra = (typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
    await updatePreferences(supabase, { extra: { ...extra, notifications: next } } as any).catch(() => {});
  }

  function saveWindow(values: Record<string, string>) {
    const from = normalizeTime(values.from ?? '');
    const to = normalizeTime(values.to ?? '');
    setEditWindow(false);
    const patch: Partial<NotifSettings> = {};
    if (from) patch.quietFrom = from;
    if (to) patch.quietTo = to;
    if (Object.keys(patch).length) update(patch);
  }

  const groups = ['NOTIFY ME ABOUT', 'STYLE'];

  return (
    <ScrollView style={styles.container}>
      {groups.map((g) => (
        <View key={g}>
          <Text style={styles.sectionLabel}>{g}</Text>
          <View style={styles.group}>
            {TOGGLE_ROWS.filter((r) => r.group === g).map((r) => (
              <View key={r.key} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Switch value={!!n[r.key]} onValueChange={(v) => update({ [r.key]: v } as Partial<NotifSettings>)} trackColor={{ true: colors.primary, false: colors.border }} />
              </View>
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.sectionLabel}>QUIET HOURS</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: spacing(3) }}>
            <Text style={styles.rowLabel}>Enable quiet hours</Text>
            <Text style={styles.rowDesc}>Mute notifications during a time window</Text>
          </View>
          <Switch value={n.quietHours} onValueChange={(v) => update({ quietHours: v })} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        {n.quietHours && (
          <Pressable style={[styles.row, styles.rowLast]} onPress={() => setEditWindow(true)}>
            <Text style={styles.rowLabel}>From / to</Text>
            <Text style={styles.rowValue}>{n.quietFrom} – {n.quietTo}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <InputModal
        visible={editWindow}
        title="Quiet hours window"
        submitLabel="Save"
        fields={[
          { key: 'from', placeholder: 'From (HH:MM, e.g. 22:00)', initial: n.quietFrom },
          { key: 'to', placeholder: 'To (HH:MM, e.g. 07:00)', initial: n.quietTo },
        ]}
        onCancel={() => setEditWindow(false)}
        onSubmit={saveWindow}
      />

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
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
    rowDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    rowValue: { color: colors.textMuted, fontSize: font.small, marginRight: spacing(2) },
  });
