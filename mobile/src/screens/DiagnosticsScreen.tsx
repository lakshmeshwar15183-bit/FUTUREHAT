// FUTUREHAT mobile — Diagnostics & app info. Shows environment details and lets
// the user share a diagnostic report to attach to a support ticket. Standalone.
import React, { useMemo } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT } from '../branding';

export default function DiagnosticsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const info: Record<string, string> = {
    App: APP_NAME,
    Version: APP_VERSION,
    Developer: CREDIT,
    Platform: `${Platform.OS} ${String(Platform.Version)}`,
    'JS engine': (global as any).HermesInternal ? 'Hermes' : 'JSC',
  };

  function shareReport() {
    const lines = [
      `=== ${APP_NAME} diagnostic report ===`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...Object.entries(info).map(([k, v]) => `${k}: ${v}`),
    ];
    Share.share({ message: lines.join('\n') });
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.group}>
        {Object.entries(info).map(([k, v], i, arr) => (
          <View key={k} style={[styles.row, i === arr.length - 1 && styles.rowLast]}>
            <Text style={styles.k}>{k}</Text>
            <Text style={styles.v}>{v}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.btn} onPress={shareReport}><Text style={styles.btnText}>Share diagnostic report</Text></Pressable>
      <Text style={styles.note}>The report is generated locally and only shared if you choose to send it.</Text>
    </ScrollView>
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
