// FUTUREHAT mobile — theme & appearance picker. Switches the live palette and
// lets premium members choose a font, chat-bubble style and app icon. Those three
// mirror the web SettingsModal appearance options and persist to user_preferences
// (font / bubble_style / app_icon) via the shared premium API.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  getPreferences,
  updatePreferences,
  getSubscription,
  isSubscriptionActive,
} from '../lib/shared';
import {
  useTheme,
  palettes,
  spacing,
  radius,
  font,
  COLOR_THEMES,
  WALLPAPERS,
  type Palette,
  type ThemePreference,
} from '../theme';

const OPTIONS: { key: ThemePreference; label: string; sub: string }[] = [
  { key: 'system', label: 'System default', sub: 'Match your device setting' },
  { key: 'dark', label: 'Dark', sub: 'Classic FUTUREHAT dark' },
  { key: 'light', label: 'Light', sub: 'Bright and clean' },
  { key: 'amoled', label: 'AMOLED black', sub: 'True black — saves battery on OLED' },
];

// Mirrors web theme/themes.ts FONTS. Only 'system' is free.
const FONTS: { id: string; label: string; premium: boolean }[] = [
  { id: 'system', label: 'System', premium: false },
  { id: 'inter', label: 'Inter', premium: true },
  { id: 'rounded', label: 'Rounded', premium: true },
  { id: 'serif', label: 'Serif', premium: true },
  { id: 'mono', label: 'Mono', premium: true },
];

// Mirrors web theme/themes.ts BUBBLES. Only 'rounded' is free.
const BUBBLES: { id: string; label: string; premium: boolean }[] = [
  { id: 'rounded', label: 'Rounded', premium: false },
  { id: 'sharp', label: 'Sharp', premium: true },
  { id: 'minimal', label: 'Minimal', premium: true },
  { id: 'classic', label: 'Tailed', premium: true },
];

// Mirrors web theme/themes.ts APP_ICONS. Only 'classic' is free.
const APP_ICONS: { id: string; label: string; premium: boolean; glyph: string }[] = [
  { id: 'classic', label: 'Classic', premium: false, glyph: '🎩' },
  { id: 'neon', label: 'Neon', premium: true, glyph: '🪩' },
  { id: 'gold', label: 'Gold', premium: true, glyph: '👑' },
  { id: 'star', label: 'Star', premium: true, glyph: '✨' },
  { id: 'ghost', label: 'Ghost', premium: true, glyph: '👻' },
];

export default function AppearanceScreen() {
  const { preference, setPreference, colors, colorTheme, setColorTheme, wallpaper, setWallpaper } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [premium, setPremium] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fontPref, setFontPref] = useState('system');
  const [bubblePref, setBubblePref] = useState('rounded');
  const [iconPref, setIconPref] = useState('classic');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [prefs, sub] = await Promise.all([
          getPreferences(supabase),
          getSubscription(supabase),
        ]);
        if (!active) return;
        setPremium(isSubscriptionActive(sub));
        if (prefs) {
          setFontPref(prefs.font || 'system');
          setBubblePref(prefs.bubble_style || 'rounded');
          setIconPref(prefs.app_icon || 'classic');
        }
        setLoaded(true);
      })();
      return () => { active = false; };
    }, []),
  );

  // Persist a single preference. Premium-locked values are ignored for free users
  // (matching the web `choose` gate) — the picker row shows a lock instead.
  const choose = useCallback(
    async (
      field: 'font' | 'bubble_style' | 'app_icon',
      id: string,
      isPremiumOption: boolean,
      apply: (id: string) => void,
      prev: string,
    ) => {
      if (isPremiumOption && !premium) return;
      apply(id);
      const { error } = await updatePreferences(supabase, { [field]: id });
      if (error) apply(prev); // revert on failure
    },
    [premium],
  );

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

      {/* Named color themes — 6 palettes shared with web (user_preferences.theme),
          the five non-Classic ones gated to FUTUREHAT+. Applied live via ThemeContext. */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Color theme</Text>
        {!premium && <Text style={styles.lockHint}>FUTUREHAT+</Text>}
      </View>
      <View style={styles.themeRow}>
        {Object.values(COLOR_THEMES).map((t) => {
          const on = colorTheme === t.id;
          const locked = t.premium && !premium;
          return (
            <Pressable
              key={t.id}
              style={[styles.themeChip, on && styles.themeChipOn]}
              onPress={() => { if (!locked) setColorTheme(t.id); }}
              disabled={!loaded}
            >
              <View style={[styles.themeSwatch, { backgroundColor: t.swatch[0], borderColor: colors.border }]}>
                <View style={[styles.themeSwatchAccent, { backgroundColor: t.swatch[1] }]} />
                {on && (
                  <View style={styles.themeCheck}>
                    <Ionicons name="checkmark-circle" size={18} color={t.swatch[1]} />
                  </View>
                )}
              </View>
              <Text style={[styles.themeLabel, on && styles.themeLabelOn]} numberOfLines={1}>
                {t.label}{locked ? ' 🔒' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Premium appearance options — font, bubble style and app icon. Persisted to
          user_preferences and gated to FUTUREHAT+ (same as the web app). */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Font</Text>
        {!premium && <Text style={styles.lockHint}>FUTUREHAT+</Text>}
      </View>
      <View style={styles.pillRow}>
        {FONTS.map((f) => {
          const on = fontPref === f.id;
          const locked = f.premium && !premium;
          return (
            <Pressable
              key={f.id}
              style={[styles.pill, on && styles.pillOn, locked && styles.pillLocked]}
              onPress={() => choose('font', f.id, f.premium, setFontPref, fontPref)}
              disabled={!loaded}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>
                {f.label}{locked ? ' 🔒' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Chat bubbles</Text>
        {!premium && <Text style={styles.lockHint}>FUTUREHAT+</Text>}
      </View>
      <View style={styles.pillRow}>
        {BUBBLES.map((b) => {
          const on = bubblePref === b.id;
          const locked = b.premium && !premium;
          return (
            <Pressable
              key={b.id}
              style={[styles.pill, on && styles.pillOn, locked && styles.pillLocked]}
              onPress={() => choose('bubble_style', b.id, b.premium, setBubblePref, bubblePref)}
              disabled={!loaded}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>
                {b.label}{locked ? ' 🔒' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>App icon</Text>
        {!premium && <Text style={styles.lockHint}>FUTUREHAT+</Text>}
      </View>
      <View style={styles.iconRow}>
        {APP_ICONS.map((a) => {
          const on = iconPref === a.id;
          const locked = a.premium && !premium;
          return (
            <Pressable
              key={a.id}
              style={[styles.iconSwatch, on && styles.iconSwatchOn, locked && styles.pillLocked]}
              onPress={() => choose('app_icon', a.id, a.premium, setIconPref, iconPref)}
              disabled={!loaded}
            >
              <Text style={styles.iconGlyph}>{a.glyph}</Text>
              <Text style={[styles.iconLabel, on && styles.iconLabelOn]}>
                {a.label}{locked ? ' 🔒' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        The launcher icon can’t change without a full app update, so your choice is saved and
        applied on the web app and future releases.
      </Text>

      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Chat wallpaper</Text>
        {!premium && <Text style={styles.lockHint}>FUTUREHAT+</Text>}
      </View>
      <View style={styles.wallpaperRow}>
        {WALLPAPERS.map((w) => {
          const on = wallpaper === w.id;
          const locked = w.premium && !premium;
          return (
            <Pressable
              key={w.id}
              style={styles.wallpaperCell}
              onPress={() => { if (!locked) setWallpaper(w.id); }}
              disabled={!loaded}
            >
              <View
                style={[
                  styles.wallpaper,
                  { backgroundColor: w.color },
                  on && { borderColor: colors.primary, borderWidth: 2 },
                ]}
              >
                {locked && <Text style={styles.wallpaperLock}>🔒</Text>}
                {on && (
                  <View style={styles.wallpaperCheck}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  </View>
                )}
              </View>
              <Text style={[styles.wallpaperLabel, on && { color: colors.primary }]} numberOfLines={1}>
                {w.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>Extra wallpapers unlock with FUTUREHAT+.</Text>

      {!loaded && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionTitle: { color: colors.primary, fontSize: font.small, fontWeight: '700', marginBottom: spacing(2), marginLeft: spacing(1) },
    premiumHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(6) },
    lockHint: { color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '700' },
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
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
    pill: {
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2.5),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    pillLocked: { opacity: 0.6 },
    pillText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    pillTextOn: { color: '#fff' },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
    iconSwatch: {
      width: 64,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingVertical: spacing(2.5),
      borderWidth: 2,
      borderColor: colors.border,
    },
    iconSwatchOn: { borderColor: colors.primary },
    iconGlyph: { fontSize: 26 },
    iconLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600', marginTop: 4 },
    iconLabelOn: { color: colors.primary },
    themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
    themeChip: { width: 64, alignItems: 'center' },
    themeChipOn: {},
    themeSwatch: {
      width: 56, height: 56, borderRadius: radius.md, borderWidth: 1,
      justifyContent: 'flex-end', padding: 6, overflow: 'hidden',
    },
    themeSwatchAccent: { height: 16, borderRadius: 4 },
    themeCheck: { position: 'absolute', top: 3, right: 3 },
    themeLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600', marginTop: 4 },
    themeLabelOn: { color: colors.primary },
    wallpaperRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
    wallpaperCell: { alignItems: 'center', width: 56 },
    wallpaper: {
      width: 56, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    wallpaperLock: { fontSize: 16 },
    wallpaperCheck: { position: 'absolute', bottom: 3, right: 3 },
    wallpaperLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600', marginTop: 4 },
    hint: { color: colors.textFaint, fontSize: font.small, marginTop: spacing(3) },
    loadingRow: { paddingVertical: spacing(6), alignItems: 'center' },
  });
