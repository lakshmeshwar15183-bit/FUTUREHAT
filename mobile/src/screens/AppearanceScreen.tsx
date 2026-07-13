// Lumixo mobile — theme & appearance picker. A live mock-chat preview at the
// top reflects the selected mode / color theme / wallpaper instantly (premium
// themes can be previewed even when locked), and the pickers below switch the
// live palette and let users choose a font, chat-bubble style and app icon.
// Font / bubble / icon persist to user_preferences (shared with web).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getPreferences } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import {
  APP_ICON_OPTIONS,
  getActiveAppIcon,
  setAppIcon,
  type AppIconId,
} from '../lib/appIcon';
import {
  useTheme,
  palettes,
  spacing,
  radius,
  font,
  COLOR_THEMES,
  WALLPAPERS,
  resolveThemeMode,
  DEFAULT_THEME_PREFERENCE,
  type Palette,
  type ThemePreference,
} from '../theme';
import { usePremium } from '../premium';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Primary three match WhatsApp; AMOLED is an extra forced-dark option.
// Follow System is the factory default — Light/Dark/AMOLED are user overrides.
const OPTIONS: { key: ThemePreference; label: string; sub: string }[] = [
  {
    key: 'system',
    label: 'Follow System',
    sub: 'Default · like WhatsApp · matches your phone',
  },
  { key: 'light', label: 'Light', sub: 'Always light · your choice' },
  { key: 'dark', label: 'Dark', sub: 'Always dark · your choice' },
  { key: 'amoled', label: 'AMOLED', sub: 'True black · OLED-friendly' },
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

type AppearancePrefs = { font: string; bubble_style: string; app_icon: string };

export default function AppearanceScreen() {
  const { preference, setPreference, colors, mode, colorTheme, setColorTheme, wallpaper, setWallpaper } = useTheme();
  const systemScheme = useColorScheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  // Preview swatch for Follow System = current phone light/dark (not always dark).
  const systemSwatchMode = resolveThemeMode('system', systemScheme);

  const { isPremium: premium } = usePremium();
  const [loaded, setLoaded] = useState(false);
  const [fontPref, setFontPref] = useState('system');
  const [bubblePref, setBubblePref] = useState('rounded');
  const [iconPref, setIconPref] = useState<AppIconId>('icon1');

  // Preview selection — starts on whatever is applied, follows taps (even on
  // locked premium themes, which preview without being applied) so the mock chat
  // above updates instantly. Kept in sync when the applied theme changes (e.g.
  // server reconcile).
  const [previewThemeId, setPreviewThemeId] = useState(colorTheme);
  const [previewWallId, setPreviewWallId] = useState(wallpaper);
  useEffect(() => { setPreviewThemeId(colorTheme); }, [colorTheme]);
  useEffect(() => { setPreviewWallId(wallpaper); }, [wallpaper]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Instant: cached appearance prefs first (offline included), then refresh.
      getCache<AppearancePrefs | null>('appearance', null).then((c) => {
        if (active && c) {
          setFontPref(c.font || 'system');
          setBubblePref(c.bubble_style || 'rounded');
          setIconPref((c.app_icon as AppIconId) || 'icon1');
          setLoaded(true);
        }
      });
      getActiveAppIcon().then((id) => { if (active) setIconPref(id); });
      (async () => {
        const prefs = await getPreferences(supabase);
        if (!active) return;
        if (prefs) {
          const next: AppearancePrefs = {
            font: prefs.font || 'system',
            bubble_style: prefs.bubble_style || 'rounded',
            app_icon: prefs.app_icon || 'icon1',
          };
          setFontPref(next.font);
          setBubblePref(next.bubble_style);
          // Prefer native/local launcher icon as source of truth for display
          const local = await getActiveAppIcon();
          setIconPref(local);
          setCache('appearance', { ...next, app_icon: local });
        }
        setLoaded(true);
      })();
      return () => { active = false; };
    }, []),
  );

  // Persist a single preference. Premium-locked values are ignored for free users
  // (matching the web `choose` gate) — the picker row shows a lock instead.
  const choose = useCallback(
    (
      field: 'font' | 'bubble_style' | 'app_icon',
      id: string,
      isPremiumOption: boolean,
      apply: (id: string) => void,
    ) => {
      if (isPremiumOption && !premium) return;
      apply(id);
      getCache<AppearancePrefs | null>('appearance', null).then((c) =>
        setCache('appearance', { ...(c ?? { font: 'system', bubble_style: 'rounded', app_icon: 'icon1' }), [field]: id } as AppearancePrefs),
      );
      queueAction('updatePreferences', { updates: { [field]: id } });
    },
    [premium],
  );

  const pickAppIcon = useCallback(
    async (id: AppIconId) => {
      // Optimistic UI — stay on Appearance; never restart or leave the screen.
      setIconPref(id);
      getCache<AppearancePrefs | null>('appearance', null).then((c) =>
        setCache('appearance', {
          font: c?.font ?? 'system',
          bubble_style: c?.bubble_style ?? 'rounded',
          app_icon: id,
        }),
      );
      queueAction('updatePreferences', { updates: { app_icon: id } });
      try {
        const result = await setAppIcon(id);
        // Android success toast is non-blocking (inside setAppIcon).
        // Only block with an alert on hard failure.
        if (!result.ok && result.error) {
          Alert.alert('Could not change icon', result.error);
        }
      } catch {
        Alert.alert(
          'Could not change icon',
          'Your choice was saved. The home-screen icon may update after a moment.',
        );
      }
    },
    [],
  );

  // Tapping a color theme always previews it; it's applied globally only if the
  // user can use it (free 'Classic' or premium account).
  const pickTheme = (id: string, locked: boolean) => {
    setPreviewThemeId(id);
    if (!locked) setColorTheme(id);
  };
  const pickWallpaper = (id: string, locked: boolean) => {
    setPreviewWallId(id);
    if (!locked) setWallpaper(id);
  };

  // ── Live preview palette (shows locked palettes too, so premium previews work) ──
  const previewColors: Palette = COLOR_THEMES[previewThemeId]?.palette ?? palettes[mode];
  const previewWallColor =
    previewWallId === 'default'
      ? previewColors.bg
      : (WALLPAPERS.find((w) => w.id === previewWallId)?.color ?? previewColors.bg);
  const previewThemeLocked = !!COLOR_THEMES[previewThemeId]?.premium && !premium;
  const previewWallLocked = !!WALLPAPERS.find((w) => w.id === previewWallId)?.premium && previewWallId !== 'default' && !premium;
  const showUpsell = previewThemeLocked || previewWallLocked;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(4), paddingBottom: spacing(10) }}>
      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <ChatPreview c={previewColors} wall={previewWallColor} bubble={bubblePref} />
      {showUpsell && (
        <Pressable style={styles.upsell} onPress={() => navigation.navigate('Premium')}>
          <Ionicons name="lock-closed" size={13} color={colors.accentPlusText} />
          <Text style={styles.upsellText}>Preview only — unlock this with Lumixo+</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accentPlusText} />
        </Pressable>
      )}

      {/* ── Mode ─────────────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Appearance</Text>
      <Text style={styles.sectionHint}>
        Opens like WhatsApp by default (Follow System). Light, Dark, and AMOLED are optional overrides you choose here.
      </Text>
      <View style={styles.modeGrid}>
        {OPTIONS.map((o) => {
          const swatch =
            o.key === 'system' ? palettes[systemSwatchMode] : palettes[o.key];
          const active = preference === o.key;
          const isDefault = o.key === DEFAULT_THEME_PREFERENCE;
          return (
            <Pressable
              key={o.key}
              style={[styles.modeCard, active && styles.modeCardOn]}
              onPress={() => setPreference(o.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${o.label}${isDefault ? ', default' : ''}`}
            >
              <View style={[styles.modeSwatch, { backgroundColor: swatch.bg, borderColor: colors.border }]}>
                <View style={[styles.modeSwatchBubbleIn, { backgroundColor: swatch.bubbleIn }]} />
                <View style={[styles.modeSwatchBubbleOut, { backgroundColor: swatch.bubbleOut }]} />
                <View style={[styles.modeSwatchDot, { backgroundColor: swatch.primary }]} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.modeLabelRow}>
                  <Text style={[styles.modeLabel, active && { color: colors.primary }]}>{o.label}</Text>
                  {isDefault && (
                    <View style={[styles.defaultBadge, active && styles.defaultBadgeOn]}>
                      <Text style={[styles.defaultBadgeText, active && { color: colors.primary }]}>Default</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.modeSub}>{o.sub}</Text>
              </View>
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={active ? colors.primary : colors.textFaint}
              />
            </Pressable>
          );
        })}
      </View>

      {/* ── Color theme ──────────────────────────────────────────────────── */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Color theme</Text>
        {!premium && <PlusTag colors={colors} />}
      </View>
      <View style={styles.tileGrid}>
        {Object.values(COLOR_THEMES).map((t) => {
          const on = previewThemeId === t.id;
          const applied = colorTheme === t.id;
          const locked = t.premium && !premium;
          return (
            <Pressable key={t.id} style={styles.tile} onPress={() => pickTheme(t.id, locked)} disabled={!loaded}>
              <View style={[styles.tileSwatch, on && { borderColor: colors.primary, borderWidth: 2 }, { backgroundColor: t.swatch[0] }]}>
                <View style={[styles.tileSwatchBar, { backgroundColor: t.swatch[1] }]} />
                {applied && (
                  <View style={styles.tileCheck}>
                    <Ionicons name="checkmark-circle" size={18} color={t.swatch[1]} />
                  </View>
                )}
                {locked && (
                  <View style={styles.tileLock}>
                    <Ionicons name="lock-closed" size={11} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={[styles.tileLabel, on && styles.tileLabelOn]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Chat wallpaper ───────────────────────────────────────────────── */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Chat wallpaper</Text>
        {!premium && <PlusTag colors={colors} />}
      </View>
      <View style={styles.tileGrid}>
        {WALLPAPERS.map((w) => {
          const on = previewWallId === w.id;
          const applied = wallpaper === w.id;
          const locked = w.premium && !premium;
          return (
            <Pressable key={w.id} style={styles.wallTileWrap} onPress={() => pickWallpaper(w.id, locked)} disabled={!loaded}>
              <View style={[styles.wallTile, { backgroundColor: w.color }, on && { borderColor: colors.primary, borderWidth: 2 }]}>
                {applied && (
                  <View style={styles.tileCheck}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  </View>
                )}
                {locked && (
                  <View style={styles.tileLock}>
                    <Ionicons name="lock-closed" size={11} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={[styles.tileLabel, on && styles.tileLabelOn]} numberOfLines={1}>{w.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Font ─────────────────────────────────────────────────────────── */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Font</Text>
        {!premium && <PlusTag colors={colors} />}
      </View>
      <View style={styles.pillRow}>
        {FONTS.map((f) => {
          const on = fontPref === f.id;
          const locked = f.premium && !premium;
          return (
            <Pressable
              key={f.id}
              style={[styles.pill, on && styles.pillOn, locked && styles.pillLocked]}
              onPress={() => choose('font', f.id, f.premium, setFontPref)}
              disabled={!loaded}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{f.label}</Text>
              {locked && <Ionicons name="lock-closed" size={11} color={colors.textFaint} style={{ marginLeft: 5 }} />}
            </Pressable>
          );
        })}
      </View>

      {/* ── Chat bubbles ─────────────────────────────────────────────────── */}
      <View style={styles.premiumHeader}>
        <Text style={styles.sectionTitle}>Chat bubbles</Text>
        {!premium && <PlusTag colors={colors} />}
      </View>
      <View style={styles.pillRow}>
        {BUBBLES.map((b) => {
          const on = bubblePref === b.id;
          const locked = b.premium && !premium;
          return (
            <Pressable
              key={b.id}
              style={[styles.pill, on && styles.pillOn, locked && styles.pillLocked]}
              onPress={() => choose('bubble_style', b.id, b.premium, setBubblePref)}
              disabled={!loaded}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{b.label}</Text>
              {locked && <Ionicons name="lock-closed" size={11} color={colors.textFaint} style={{ marginLeft: 5 }} />}
            </Pressable>
          );
        })}
      </View>

      {/* ── App icon ─────────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>App icon</Text>
      <Text style={styles.currentIconLabel}>Current icon</Text>
      <View style={styles.currentIconRow}>
        {(() => {
          const current = APP_ICON_OPTIONS.find((a) => a.id === iconPref) ?? APP_ICON_OPTIONS[0];
          return (
            <>
              <Image source={current.preview} style={styles.currentIconImg} />
              <View style={{ flex: 1 }}>
                <Text style={styles.currentIconName}>{current.label}</Text>
                <Text style={styles.currentIconSub}>App name stays Lumixo</Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            </>
          );
        })()}
      </View>
      <View style={styles.iconRow}>
        {APP_ICON_OPTIONS.map((a) => {
          const on = iconPref === a.id;
          return (
            <Pressable
              key={a.id}
              style={[styles.iconTile, on && styles.iconTileOn]}
              onPress={() => pickAppIcon(a.id)}
              disabled={!loaded}
            >
              <Image source={a.preview} style={styles.iconPreview} />
              <Text style={[styles.iconLabel, on && styles.iconLabelOn]}>{a.label}</Text>
              {on && (
                <View style={styles.iconOnBadge}>
                  <Ionicons name="checkmark" size={10} color="#fff" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        Tap an icon to change the home-screen launcher icon immediately. Your choice is saved
        on this device and syncs with your account. The app name always remains Lumixo.
      </Text>

      {!loaded && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </ScrollView>
  );
}

// Lumixo+ tag used on premium section headers.
function PlusTag({ colors }: { colors: Palette }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name="sparkles" size={11} color={colors.accentPlusText} />
      <Text style={{ color: colors.accentPlusText, fontSize: font.tiny, fontWeight: '800' }}>Lumixo+</Text>
    </View>
  );
}

// Mini WhatsApp-style chat that renders in whatever palette + wallpaper is being
// previewed. Bubble radius follows the chosen bubble style so that picker is
// meaningful in the preview too.
function ChatPreview({ c, wall, bubble }: { c: Palette; wall: string; bubble: string }) {
  const headerText = c.isLight ? '#fff' : c.text;
  const rounded = bubble === 'sharp' ? 6 : bubble === 'minimal' ? 4 : 16;
  const s = previewStyles;
  return (
    <View style={[s.card, { borderColor: c.border }]}>
      <View style={[s.header, { backgroundColor: c.header }]}>
        <View style={[s.avatar, { backgroundColor: c.primary }]}>
          <Ionicons name="person" size={16} color={c.isLight ? '#fff' : c.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.hName, { color: headerText }]}>Alex Rivera</Text>
          <Text style={[s.hSub, { color: c.isLight ? 'rgba(255,255,255,0.8)' : c.textMuted }]}>online</Text>
        </View>
        <Ionicons name="videocam" size={17} color={headerText} style={{ marginRight: 14 }} />
        <Ionicons name="call" size={15} color={headerText} />
      </View>

      <View style={[s.body, { backgroundColor: wall }]}>
        <View style={[s.rowIn]}>
          <View style={[s.bubble, { backgroundColor: c.bubbleIn, borderTopLeftRadius: 4, borderTopRightRadius: rounded, borderBottomLeftRadius: rounded, borderBottomRightRadius: rounded }]}>
            <Text style={[s.bText, { color: c.text }]}>Hey! Have you seen the new theme? 🎨</Text>
            <Text style={[s.bTime, { color: c.textFaint }]}>9:41</Text>
          </View>
        </View>
        <View style={[s.rowOut]}>
          <View style={[s.bubble, { backgroundColor: c.bubbleOut, borderTopRightRadius: 4, borderTopLeftRadius: rounded, borderBottomLeftRadius: rounded, borderBottomRightRadius: rounded }]}>
            <Text style={[s.bText, { color: c.bubbleOutText }]}>Just switched — looks amazing ✨</Text>
            <View style={s.bMeta}>
              <Text style={[s.bTime, { color: c.bubbleOutMuted }]}>9:41</Text>
              <Ionicons name="checkmark-done" size={13} color="#53BDEB" style={{ marginLeft: 3 }} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', marginBottom: spacing(3) },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(3), paddingVertical: spacing(2.5) },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: spacing(2.5) },
  hName: { fontSize: font.body, fontWeight: '700' },
  hSub: { fontSize: font.tiny, marginTop: 1 },
  body: { paddingHorizontal: spacing(3), paddingVertical: spacing(3), minHeight: 128, justifyContent: 'center' },
  rowIn: { alignItems: 'flex-start', marginBottom: spacing(2) },
  rowOut: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: spacing(3), paddingVertical: spacing(2) },
  bText: { fontSize: font.small, lineHeight: 19 },
  bMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2 },
  bTime: { fontSize: 10, alignSelf: 'flex-end', marginTop: 2 },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionTitle: { color: colors.primary, fontSize: font.small, fontWeight: '800', letterSpacing: 0.3, marginBottom: spacing(1), marginLeft: spacing(1) },
    sectionHint: {
      color: colors.textMuted,
      fontSize: font.tiny,
      lineHeight: 16,
      marginBottom: spacing(2.5),
      marginHorizontal: spacing(1),
    },
    premiumHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(6) },
    upsell: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(2),
      backgroundColor: colors.accentPlus + '1E', borderRadius: radius.md,
      paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), marginBottom: spacing(3),
    },
    upsellText: { flex: 1, color: colors.accentPlusText, fontSize: font.small, fontWeight: '700' },
    // Mode cards (full width list — clearer WhatsApp-style radio choices)
    modeGrid: { gap: spacing(2) },
    modeCard: {
      width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing(2.5),
      backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(2.5),
      borderWidth: 1.5, borderColor: colors.border,
    },
    modeCardOn: { borderColor: colors.primary },
    modeSwatch: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden', padding: 5, justifyContent: 'center' },
    modeSwatchBubbleIn: { position: 'absolute', top: 7, left: 6, width: 20, height: 7, borderRadius: 4 },
    modeSwatchBubbleOut: { position: 'absolute', bottom: 8, right: 6, width: 22, height: 7, borderRadius: 4 },
    modeSwatchDot: { position: 'absolute', bottom: 7, left: 7, width: 9, height: 9, borderRadius: 5 },
    modeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    modeLabel: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    modeSub: { color: colors.textMuted, fontSize: font.tiny, marginTop: 1 },
    defaultBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    defaultBadgeOn: {
      backgroundColor: colors.primary + '18',
      borderColor: colors.primary + '55',
    },
    defaultBadgeText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.2,
      textTransform: 'uppercase',
    },
    // Swatch tile grid (themes + wallpapers)
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
    tile: { width: 68, alignItems: 'center' },
    tileSwatch: {
      width: 60, height: 60, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      justifyContent: 'flex-end', padding: 7, overflow: 'hidden',
    },
    tileSwatchBar: { height: 16, borderRadius: 5 },
    tileCheck: { position: 'absolute', top: 4, right: 4 },
    tileLock: {
      position: 'absolute', top: 4, left: 4, width: 18, height: 18, borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
    },
    tileLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600', marginTop: spacing(1.5) },
    tileLabelOn: { color: colors.primary },
    wallTileWrap: { width: 68, alignItems: 'center' },
    wallTile: {
      width: 60, height: 86, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    // Pills (font + bubbles)
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
    pill: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: radius.pill,
      paddingHorizontal: spacing(4), paddingVertical: spacing(2.5),
      borderWidth: 1.5, borderColor: colors.border,
    },
    pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    pillLocked: { opacity: 0.65 },
    pillText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
    pillTextOn: { color: '#fff' },
    // App icon tiles
    currentIconLabel: {
      color: colors.textMuted,
      fontSize: font.tiny,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginBottom: spacing(2),
      marginLeft: spacing(1),
    },
    currentIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(3.5),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: spacing(4),
    },
    currentIconImg: { width: 56, height: 56, borderRadius: 14 },
    currentIconName: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    currentIconSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
    iconTile: {
      width: 96,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: spacing(3),
      paddingHorizontal: spacing(2),
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    iconTileOn: { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
    iconPreview: { width: 56, height: 56, borderRadius: 14 },
    iconLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600', marginTop: 8 },
    iconLabelOn: { color: colors.primary },
    iconOnBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hint: { color: colors.textFaint, fontSize: font.small, marginTop: spacing(3), lineHeight: 18 },
    loadingRow: { paddingVertical: spacing(6), alignItems: 'center' },
  });
