// Lumixo mobile — Storage & Data (WhatsApp/Telegram-class).
// Controls auto-download networks, cache size, clear cache, and usage.
// Full media files are never auto-pulled after reinstall unless the user opts in.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../lib/supabase';
import { getPreferences } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { clearMediaCache, getMediaCacheStats, pruneMediaCache } from '../lib/mediaCache';
import {
  DEFAULT_MEDIA_STORAGE,
  applyServerStorageExtra,
  formatBytes,
  getMediaStorageSettings,
  hydrateMediaStorageSettings,
  setMediaStorageSettings,
  subscribeMediaStorage,
  type MediaQualityPref,
  type MediaStorageSettings,
} from '../lib/mediaPolicy';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { Alert } from '../ui/dialog';

const CACHE_PRESETS: { label: string; bytes: number }[] = [
  { label: '256 MB', bytes: 256 * 1024 * 1024 },
  { label: '512 MB', bytes: 512 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 * 1024 * 1024 },
  { label: '2 GB', bytes: 2 * 1024 * 1024 * 1024 },
];

const QUALITY: { id: MediaQualityPref; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High quality' },
  { id: 'data_saver', label: 'Data saver' },
];

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
  const [s, setS] = useState<MediaStorageSettings>(DEFAULT_MEDIA_STORAGE);
  const [mediaBytes, setMediaBytes] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const [tmpBytes, setTmpBytes] = useState(0);
  const [disk, setDisk] = useState<{ free: number; total: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  const measure = useCallback(async () => {
    const dir = FileSystem.cacheDirectory;
    const tmp = dir ? await dirSize(dir) : 0;
    setTmpBytes(tmp);
    try {
      const stats = await getMediaCacheStats();
      setMediaBytes(stats.bytes);
      setMediaCount(stats.count);
    } catch {
      setMediaBytes(0);
      setMediaCount(0);
    }
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
    void hydrateMediaStorageSettings().then(setS);
    return subscribeMediaStorage(() => setS(getMediaStorageSettings()));
  }, []);

  useEffect(() => {
    getCache<Partial<MediaStorageSettings> | null>('storage', null).then((c) => {
      if (c) void setMediaStorageSettings(c);
    });
    getPreferences(supabase)
      .then((p: { extra?: Record<string, unknown> } | null) => {
        const storage = (p?.extra && (p.extra as { storage?: Record<string, unknown> }).storage) ?? null;
        if (storage) {
          applyServerStorageExtra(storage as Record<string, unknown>);
          setCache('storage', getMediaStorageSettings());
        }
      })
      .catch(() => {});
    measure();
  }, [measure]);

  function update(patch: Partial<MediaStorageSettings>) {
    void setMediaStorageSettings(patch).then((next) => {
      setS(next);
      setCache('storage', next);
      queueAction('mergeExtra', { path: ['storage'], value: next });
      if (typeof patch.maxCacheBytes === 'number') {
        void pruneMediaCache(patch.maxCacheBytes).then(() => measure());
      }
    });
  }

  async function clearCache() {
    setClearing(true);
    try {
      const dir = FileSystem.cacheDirectory;
      if (dir) {
        const entries = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
        const base = dir.endsWith('/') ? dir : `${dir}/`;
        await Promise.all(
          entries.map((name) =>
            FileSystem.deleteAsync(base + name, { idempotent: true }).catch(() => {}),
          ),
        );
      }
      await clearMediaCache();
      // Do not wipe message history cache — only media blobs.
      const keys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
      const mediaKeys = keys.filter((k) => k.startsWith('fh:media-index'));
      if (mediaKeys.length) await AsyncStorage.multiRemove([...mediaKeys]);
      await measure();
      Alert.alert(
        'Storage',
        'Cached media cleared. Chat history is kept. Cloud files are not deleted.',
      );
    } catch {
      Alert.alert('Storage', 'Could not clear cache.');
    } finally {
      setClearing(false);
    }
  }

  const used = mediaBytes + tmpBytes;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionLabel}>STORAGE USED</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Media cache</Text>
            <Text style={styles.rowDesc}>
              {formatBytes(mediaBytes)} · {mediaCount} file{mediaCount === 1 ? '' : 's'} on this device
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Temp / previews</Text>
            <Text style={styles.rowDesc}>{formatBytes(tmpBytes)}</Text>
          </View>
        </View>
        <View style={[styles.row, styles.rowLast]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Total app media cache</Text>
            <Text style={styles.rowDesc}>{formatBytes(used)}</Text>
          </View>
        </View>
        {disk && (() => {
          const usedDevice = Math.max(0, disk.total - disk.free);
          const pct = Math.min(100, Math.round((usedDevice / disk.total) * 100));
          return (
            <View style={[styles.row, styles.rowLast, { flexDirection: 'column', alignItems: 'stretch' }]}>
              <View style={styles.diskRow}>
                <Text style={styles.rowLabel}>{formatBytes(usedDevice)} used</Text>
                <Text style={styles.rowDesc}>
                  of {formatBytes(disk.total)} ({pct}%)
                </Text>
              </View>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.rowDesc}>{formatBytes(disk.free)} free on this device</Text>
            </View>
          );
        })()}
      </View>

      <Pressable style={styles.clearBtn} onPress={clearCache} disabled={clearing}>
        {clearing ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.clearBtnText}>Clear cache</Text>
        )}
      </Pressable>
      <Text style={styles.note}>
        Clears downloaded media on this phone only. Messages and cloud files stay intact.
      </Text>

      <Text style={styles.sectionLabel}>AUTO-DOWNLOAD</Text>
      <Text style={styles.sectionHint}>
        After reinstall or login, Lumixo never mass-downloads media. Turn these on only if you want
        automatic downloads.
      </Text>
      <View style={styles.group}>
        <ToggleRow
          styles={styles}
          label="Download only when tapped"
          desc="Default · like Telegram — full file only when you open it"
          value={s.downloadOnlyWhenTapped}
          onChange={(v) => update({ downloadOnlyWhenTapped: v })}
          colors={colors}
        />
        <ToggleRow
          styles={styles}
          label="Auto-download on Wi‑Fi"
          desc="Photos & media when connected to Wi‑Fi"
          value={s.autoDownloadWifi}
          onChange={(v) => update({ autoDownloadWifi: v, downloadOnlyWhenTapped: v ? false : s.downloadOnlyWhenTapped })}
          colors={colors}
          disabled={s.downloadOnlyWhenTapped}
        />
        <ToggleRow
          styles={styles}
          label="Auto-download on mobile data"
          desc="Uses cellular data for media"
          value={s.autoDownloadCellular}
          onChange={(v) => update({ autoDownloadCellular: v, downloadOnlyWhenTapped: v ? false : s.downloadOnlyWhenTapped })}
          colors={colors}
          disabled={s.downloadOnlyWhenTapped}
        />
        <ToggleRow
          styles={styles}
          label="Auto-download while roaming"
          desc="Allow cellular auto-download when roaming"
          value={s.autoDownloadRoaming}
          onChange={(v) => update({ autoDownloadRoaming: v })}
          colors={colors}
          disabled={s.downloadOnlyWhenTapped || !s.autoDownloadCellular}
          last
        />
      </View>

      <Text style={styles.sectionLabel}>WHEN AUTO-DOWNLOAD IS ON</Text>
      <Text style={styles.sectionHint}>
        Choose which media types may download automatically. Photos &amp; voice stay light; videos/docs stay off by default.
      </Text>
      <View style={styles.group}>
        {([
          { key: 'photos' as const, label: 'Photos' },
          { key: 'videos' as const, label: 'Videos' },
          { key: 'audio' as const, label: 'Voice notes' },
          { key: 'documents' as const, label: 'Documents' },
          { key: 'gifs' as const, label: 'GIFs' },
        ]).map((row, i, arr) => (
          <ToggleRow
            key={row.key}
            styles={styles}
            label={row.label}
            desc=""
            value={s.kindAuto?.[row.key] ?? true}
            onChange={(v) =>
              update({
                kindAuto: {
                  ...(s.kindAuto ?? {
                    photos: true,
                    videos: false,
                    audio: true,
                    documents: false,
                    gifs: true,
                  }),
                  [row.key]: v,
                },
              })
            }
            colors={colors}
            disabled={s.downloadOnlyWhenTapped}
            last={i === arr.length - 1}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>MAXIMUM MEDIA CACHE</Text>
      <View style={styles.chipRow}>
        {CACHE_PRESETS.map((p) => {
          const on = s.maxCacheBytes === p.bytes;
          return (
            <Pressable
              key={p.label}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => update({ maxCacheBytes: p.bytes })}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>
        Oldest cached files are removed automatically when the limit is exceeded. Cloud copies are never deleted.
      </Text>

      <Text style={styles.sectionLabel}>MEDIA QUALITY</Text>
      <View style={styles.group}>
        {QUALITY.map((q, i) => (
          <Pressable
            key={q.id}
            style={[styles.row, i === QUALITY.length - 1 && styles.rowLast]}
            onPress={() => update({ mediaQuality: q.id })}
          >
            <Text style={styles.rowLabel}>{q.label}</Text>
            <Text style={styles.check}>{s.mediaQuality === q.id ? '✓' : ''}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>DATA SAVER</Text>
      <View style={styles.group}>
        <ToggleRow
          styles={styles}
          label="Data saver for calls"
          desc="Lower video call quality"
          value={s.dataSaverCalls}
          onChange={(v) => update({ dataSaverCalls: v })}
          colors={colors}
        />
        <ToggleRow
          styles={styles}
          label="Low-data mode"
          desc="Reduce background media activity"
          value={s.lowDataMode}
          onChange={(v) => update({ lowDataMode: v })}
          colors={colors}
          last
        />
      </View>

      <View style={{ height: spacing(10) }} />
    </ScrollView>
  );
}

function ToggleRow({
  styles,
  label,
  desc,
  value,
  onChange,
  colors,
  last,
  disabled,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: Palette;
  last?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast, disabled && { opacity: 0.45 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!desc && <Text style={styles.rowDesc}>{desc}</Text>}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: font.tiny,
      fontWeight: '700',
      marginTop: spacing(5),
      marginBottom: spacing(2),
      marginHorizontal: spacing(4),
      letterSpacing: 0.5,
    },
    sectionHint: {
      color: colors.textFaint,
      fontSize: font.small,
      marginHorizontal: spacing(4),
      marginBottom: spacing(2),
      lineHeight: 18,
    },
    group: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing(3),
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { color: colors.text, fontSize: font.body },
    rowDesc: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 2,
      marginRight: spacing(3),
    },
    diskRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    bar: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginVertical: spacing(2),
    },
    barFill: { height: '100%', backgroundColor: colors.primary },
    clearBtn: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing(3),
      marginTop: spacing(2),
      borderRadius: radius.md,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
    },
    clearBtnText: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
    note: {
      color: colors.textFaint,
      fontSize: font.small,
      marginHorizontal: spacing(4),
      marginTop: spacing(2),
      lineHeight: 18,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginHorizontal: spacing(3),
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
    chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    chipTextOn: { color: colors.primary },
    check: { color: colors.primary, fontSize: 18, fontWeight: '700', width: 24, textAlign: 'center' },
  });
