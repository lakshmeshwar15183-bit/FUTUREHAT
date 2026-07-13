// Lumixo mobile — Diagnostics & app info. Shows environment details and lets
// the user share a diagnostic report to attach to a support ticket. Standalone.
import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  NativeModules,
  PixelRatio,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View
} from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from '@react-navigation/native';

import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT } from '../branding';
import { getLastCrash } from '../lib/prodLog';
import { runProdHealthChecks } from '../lib/prodHealth';
import { getLatencySummary } from '../lib/notifLatency';
import { isNativeIncomingCallAvailable } from '../lib/incomingCallNative';

// Device locale from RN's built-in native settings (no extra dependency).
// iOS exposes an array under AppleLanguages; Android exposes a `localeIdentifier`.
function deviceLocale(): string {
  try {
    const s: any = NativeModules.SettingsManager?.settings;
    const ios = s?.AppleLocale || s?.AppleLanguages?.[0];
    const android = NativeModules.I18nManager?.localeIdentifier;
    return ios || android || 'unknown';
  } catch {
    return 'unknown';
  }
}

export default function DiagnosticsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [online, setOnline] = useState('checking…');
  const [connection, setConnection] = useState('unknown');
  const [lastCrash, setLastCrash] = useState<string>('none');
  const [healthLines, setHealthLines] = useState<string[]>([]);
  const [latencyLine, setLatencyLine] = useState('no samples yet');

  const { width, height } = Dimensions.get('window');
  const scale = PixelRatio.get();

  const info: Record<string, string> = {
    App: APP_NAME,
    Version: APP_VERSION,
    Developer: CREDIT,
    Platform: `${Platform.OS} ${String(Platform.Version)}`,
    'JS engine': (global as any).HermesInternal ? 'Hermes' : 'JSC',
    Language: deviceLocale(),
    Online: online,
    Connection: connection,
    Screen: `${Math.round(width)}×${Math.round(height)} @${scale}x`,
    'Last crash': lastCrash,
    'Native call notif': isNativeIncomingCallAvailable() ? 'yes (CallStyle/full-screen)' : 'fallback (expo)',
    'Notif latency': latencyLine,
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      NetInfo.fetch().then((state) => {
        if (!active) return;
        setOnline(state.isConnected ? 'yes' : 'no');
        setConnection(state.type || 'unknown');
      });
      getLastCrash().then((c) => {
        if (!active) return;
        setLastCrash(c ? `${c.at} · ${c.label}: ${c.message}` : 'none');
      });
      getLatencySummary().then((s) => {
        if (!active) return;
        if (!s.count) {
          setLatencyLine('no samples yet');
          return;
        }
        setLatencyLine(
          `n=${s.count} avg=${s.avgDeliveryMs}ms p95=${s.p95DeliveryMs}ms`,
        );
      });
      // Refresh production health (TURN, auth redirect, Supabase).
      void runProdHealthChecks().then((r) => {
        if (!active) return;
        setHealthLines(
          r.items.map((i) => `${i.ok ? 'OK' : i.severity.toUpperCase()} · ${i.id}: ${i.message}`),
        );
      });
      return () => { active = false; };
    }, []),
  );

  function shareReport() {
    const lines = [
      `=== ${APP_NAME} diagnostic report ===`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...Object.entries(info).map(([k, v]) => `${k}: ${v}`),
      '',
      '=== Production health ===',
      ...(healthLines.length ? healthLines : ['(no health report yet)']),
    ];
    Share.share({ message: lines.join('\n') });
  }

  return (
    <SafeScrollView style={styles.container}>
      <View style={styles.group}>
        {Object.entries(info).map(([k, v], i, arr) => (
          <View key={k} style={[styles.row, i === arr.length - 1 && styles.rowLast]}>
            <Text style={styles.k}>{k}</Text>
            <Text style={styles.v}>{v}</Text>
          </View>
        ))}
      </View>
      {healthLines.length > 0 && (
        <View style={[styles.group, { marginTop: spacing(3) }]}>
          <Text style={[styles.k, { padding: spacing(3), fontWeight: '700' }]}>Production health</Text>
          {healthLines.map((line, i) => (
            <View key={i} style={[styles.row, i === healthLines.length - 1 && styles.rowLast]}>
              <Text style={styles.v}>{line}</Text>
            </View>
          ))}
        </View>
      )}
      <Pressable style={styles.btn} onPress={shareReport}><Text style={styles.btnText}>Share diagnostic report</Text></Pressable>
      <Text style={styles.note}>The report is generated locally and only shared if you choose to send it. Critical health lines (TURN, auth redirect) must be OK before public release.</Text>
    </SafeScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), marginTop: spacing(4), borderRadius: radius.md, overflow: 'hidden' },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLast: { borderBottomWidth: 0 },
    k: { color: colors.textMuted, fontSize: font.body },
    v: { color: colors.text, fontSize: font.body, flexShrink: 1, textAlign: 'right', marginLeft: spacing(3) },
    btn: { backgroundColor: colors.primary, marginHorizontal: spacing(3), marginTop: spacing(4), borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    btnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    note: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(3), marginHorizontal: spacing(4) },
  });
