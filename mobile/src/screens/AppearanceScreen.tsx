// FUTUREHAT mobile — theme & appearance picker. Switches the live palette.
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, palettes, spacing, radius, font, type Palette, type ThemePreference } from '../theme';

const OPTIONS: { key: ThemePreference; label: string; sub: string }[] = [
  { key: 'system', label: 'System default', sub: 'Match your device setting' },
  { key: 'dark', label: 'Dark', sub: 'Classic FUTUREHAT dark' },
  { key: 'light', label: 'Light', sub: 'Bright and clean' },
  { key: 'amoled', label: 'AMOLED black', sub: 'True black — saves battery on OLED' },
];

export default function AppearanceScreen() {
  const { preference, setPreference, colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(4) }}>
      <Text style={styles.sectionTitle}>Theme</Text>
      {OPTIONS.map((o) => {
        const swatch = o.key === 'system' ? palettes.dark : palettes[o.key];
        const active = preference === o.key;
        return (
          <Pressable key={o.key} style={styles.row} onPress={() => setPreference(o.key)}>
            <View style={[styles.swatch, { backgroundColor: swatch.bg, borderColor: colors.border }]}>
              <View style={[styles.swatchDot, { backgroundColor: swatch.primary }]} />
              <View style={[styles.swatchBubble, { backgroundColor: swatch.bubbleOut }]} />
            </View>
            <View style={{ flex: 1, marginLeft: spacing(4) }}>
              <Text style={styles.label}>{o.label}</Text>
              <Text style={styles.sub}>{o.sub}</Text>
            </View>
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={active ? colors.primary : colors.textFaint}
            />
          </Pressable>
        );
      })}

      <Text style={[styles.sectionTitle, { marginTop: spacing(6) }]}>Chat wallpaper</Text>
      <View style={styles.wallpaperRow}>
        {['#0B141A', '#1A2C24', '#222E35', '#15202B', '#2A1F2D'].map((c) => (
          <View key={c} style={[styles.wallpaper, { backgroundColor: c }]} />
        ))}
      </View>
      <Text style={styles.hint}>More wallpapers unlock with FUTUREHAT+.</Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionTitle: { color: colors.primary, fontSize: font.small, fontWeight: '700', marginBottom: spacing(2), marginLeft: spacing(1) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing(3),
      marginBottom: spacing(2),
    },
    swatch: {
      width: 52,
      height: 52,
      borderRadius: radius.sm,
      borderWidth: 1,
      padding: 6,
      justifyContent: 'space-between',
    },
    swatchDot: { width: 14, height: 14, borderRadius: 7 },
    swatchBubble: { width: 28, height: 10, borderRadius: 5, alignSelf: 'flex-end' },
    label: { color: colors.text, fontSize: font.heading, fontWeight: '500' },
    sub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    wallpaperRow: { flexDirection: 'row', gap: spacing(2) },
    wallpaper: { width: 56, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
    hint: { color: colors.textFaint, fontSize: font.small, marginTop: spacing(3) },
  });
