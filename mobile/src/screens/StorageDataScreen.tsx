// Lumixo mobile — Storage & data: on-device storage usage, clear cached media,
// data-saver for calls, low-data mode, and auto-download controls. Standalone;
// the toggles are stored in user_preferences.extra.storage. Storage usage is
// computed from the app's expo-file-system cache directory (no new dependency —
// expo-file-system is already installed); "Clear cached media" also drops the
// local-first AsyncStorage cache (fh:cache:* keys).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../lib/supabase';
import { getPreferences } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface StorageSettings { dataSaverCalls: boolean; lowDataMode: boolean; autoDownloadWifiOnly: boolean }
const DEFAULTS: StorageSettings = { dataSaverCalls: false, lowDataMode: false, autoDownloadWifiOnly: false };

const ROWS: { key: keyof StorageSettings; label: string; desc: string }[] = [
  { key: 'dataSaverCalls', label: 'Data saver for calls', desc: 'Lower video quality to use less data' },
  { key: 'lowDataMode', label: 'Low-data mode', desc: 'Reduce background data & media autoplay' },
  { key: 'autoDownloadWifiOnly', label: 'Auto-download on Wi-Fi only', desc: 'Don’t auto-download media on mobile data' },
];

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

// Recursively sum the byte size of everything under a directory.
async function dirSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) return 0;
    if (!info.isDirectory) return info.size ?? 0;
    const entries = await FileSystem.readDirectoryAsync(uri);
    const base = uri.endsWith('/') ? uri : `${uri}/`;
    const sizes = await Promise.all(entries.map((name) => dirSize(base + name)));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

export default function StorageDataScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [s, setS] = useState<StorageSettings>(DEFAULTS);
  const [used, setUsed] = useState<number | null>(null);
  const [disk, setDisk] = useState<{ free: number; total: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  const measure = useCallback(async () => {
    const dir = FileSystem.cacheDirectory;
    if (!dir) { setUsed(null); return; }
    setUsed(await dirSize(dir));
    // Device-level usage → used/quota + % bar (parity with web navigator.storage.estimate).
    try {
      const [free, total] = await Promise.all([
        FileSystem.getFreeDiskStorageAsync(),
        FileSystem.getTotalDiskCapacityAsync(),
      ]);
      if (total > 0) setDisk({ free, total });
    } catch {
      setDisk(null);
    }
  }, []);

  useEffect(() => {
    // Instant: cached storage settings first (offline included), then refresh.
    getCache<StorageSettings | null>('storage', null).then((c) => { if (c) setS({ ...DEFAULTS, ...c }); });
    getPreferences(supabase)
      .then((p: any) => {
        const merged = { ...DEFAULTS, ...((p?.extra && p.extra.storage) ?? {}) };
        setS(merged);
        setCache('storage', merged);
      })
      .catch(() => {});
    measure();
  }, [measure]);

  function update(patch: Partial<StorageSettings>) {
    const next = { ...s, ...patch };
    setS(next);               // instant UI
    setCache('storage', next); // instant local persistence (offline included)
    // Conflict-safe partial write into prefs.extra.storage — see mergeExtra in
    // sync.ts. Never clobbers extra.notifications; auto-retries on reconnect.
    queueAction('mergeExtra', { path: ['storage'], value: next });
  }

  async function clearCache() {
    setClearing(true);
    try {
      // 1) Wipe the expo-file-system cache directory (downloaded/temp media).
      const dir = FileSystem.cacheDirectory;
      if (dir) {
        const entries = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
        const base = dir.endsWith('/') ? dir : `${dir}/`;
        await Promise.all(entries.map((name) => FileSystem.deleteAsync(base + name, { idempotent: true }).catch(() => {})));
      }
      // 2) Drop the local-first AsyncStorage cache (cached conversations/messages/
      //    profiles). Auth session and drafts/outbox are left untouched.
      const keys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
      const cacheKeys = keys.filter((k) => k.startsWith('fh:cache:'));
      if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
      await measure();
      Alert.alert('Storage', 'Cached media cleared.');
    } catch {
      Alert.alert('Storage', 'Could not clear cache.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionLabel}>STORAGE USED</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Cached media &amp; data</Text>
            <Text style={styles.rowDesc}>
              {used === null ? 'Storage estimate not available.' : `${fmtBytes(used)} in this app’s cache`}
            </Text>
          </View>
          {used === null && <ActivityIndicator color={colors.primary} />}
        </View>
        {disk && (() => {
          const usedDevice = Math.max(0, disk.total - disk.free);
          const pct = Math.min(100, Math.round((usedDevice / disk.total) * 100));
          return (
            <View style={[styles.row, styles.rowLast, { flexDirection: 'column', alignItems: 'stretch' }]}>
              <View style={styles.diskRow}>
                <Text style={styles.rowLabel}>{fmtBytes(usedDevice)} used</Text>
                <Text style={styles.rowDesc}>of {fmtBytes(disk.total)} ({pct}%)</Text>
              </View>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.rowDesc}>{fmtBytes(disk.free)} free on this device</Text>
            </View>
          );
        })()}
      </View>
      <Pressable style={styles.clearBtn} onPress={clearCache} disabled={clearing}>
        {clearing
          ? <ActivityIndicator color={colors.primary} />
          : <Text style={styles.clearBtnText}>Clear cached media</Text>}
      </Pressable>

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
      <Text style={styles.note}>Per-network rules and OS-level network usage stats aren’t available to the app.</Text>
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
    diskRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    bar: { height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden', marginVertical: spacing(2) },
    barFill: { height: '100%', backgroundColor: colors.primary },
    clearBtn: { backgroundColor: colors.surface, marginHorizontal: spacing(3), marginTop: spacing(2), borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    clearBtnText: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
    note: { color: colors.textFaint, fontSize: font.small, marginHorizontal: spacing(4), marginTop: spacing(3) },
  });
