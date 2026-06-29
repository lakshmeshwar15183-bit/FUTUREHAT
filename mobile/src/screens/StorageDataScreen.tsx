// FUTUREHAT mobile — Storage & data: data-saver for calls, low-data mode, and
// auto-download controls. Standalone; stored in user_preferences.extra.storage.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface StorageSettings { dataSaverCalls: boolean; lowDataMode: boolean; autoDownloadWifiOnly: boolean }
const DEFAULTS: StorageSettings = { dataSaverCalls: false, lowDataMode: false, autoDownloadWifiOnly: false };

const ROWS: { key: keyof StorageSettings; label: string; desc: string }[] = [
  { key: 'dataSaverCalls', label: 'Data saver for calls', desc: 'Lower video quality to use less data' },
  { key: 'lowDataMode', label: 'Low-data mode', desc: 'Reduce background data & media autoplay' },
  { key: 'autoDownloadWifiOnly', label: 'Auto-download on Wi-Fi only', desc: 'Don’t auto-download media on mobile data' },
];

export default function StorageDataScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [s, setS] = useState<StorageSettings>(DEFAULTS);

  useEffect(() => {
    getPreferences(supabase).then((p: any) => setS({ ...DEFAULTS, ...((p?.extra && p.extra.storage) ?? {}) })).catch(() => {});
  }, []);

  async function update(patch: Partial<StorageSettings>) {
    const next = { ...s, ...patch };
    setS(next);
    const prefs: any = await getPreferences(supabase).catch(() => ({}));
    const extra = (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
    await updatePreferences(supabase, { extra: { ...extra, storage: next } } as any);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionLabel}>DATA USAGE</Text>
      <View style={styles.group}>
        {ROWS.map((r, i) => (
          <View key={r.key} style={[styles.row, i === ROWS.length - 1 && styles.rowLast]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowDesc}>{r.desc}</Text>
            </View>
            <Switch value={!!s[r.key]} onValueChange={(v) => update({ [r.key]: v } as Partial<StorageSettings>)} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
        ))}
      </View>
      <Text style={styles.note}>Storage usage details and cache cleanup are managed by your device’s app settings.</Text>
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
    rowLabel: { color: colors.text, fontSize: font.body },
    rowDesc: { color: colors.textMuted, fontSize: font.small, marginTop: 2, marginRight: spacing(3) },
    note: { color: colors.textFaint, fontSize: font.small, marginHorizontal: spacing(4), marginTop: spacing(3) },
  });
