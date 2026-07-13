// Lumixo mobile — theme provider.
//
// DEFAULT: Follow System (WhatsApp-class). First launch matches the device
// appearance with no manual step. Runtime OS light/dark changes update LIVE
// without remounting navigation, auth, chat drafts, or media.
//
// Dimensions:
//  1. MODE preference: system | light | dark | amoled (device-local AsyncStorage)
//  2. COLOR THEME + WALLPAPER (server prefs, premium-gated)
//
// System scheme sources (merged, debounced):
//  • Native Android UI_MODE_NIGHT (LumixoSystemTheme) — primary on Android
//  • React Native Appearance + useColorScheme
//  • AppState resume re-poll
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

import { palettes, type Palette, type ThemeMode } from './palettes';
import {
  DEFAULT_THEME_PREFERENCE,
  resolveThemeMode,
  normalizeSystemScheme,
  isValidThemePreference,
  type ThemePreference,
} from './themeMode';
import { resolveThemePalette, resolveWallpaperColor } from './appearance';
import {
  applySystemChrome,
  readAppearanceScheme,
  readSystemScheme,
  subscribeSystemScheme,
  type SystemScheme,
} from './systemScheme';
import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { usePremiumOptional } from '../premium';

export type { ThemePreference };
export {
  DEFAULT_THEME_PREFERENCE,
  resolveThemeMode,
  isValidThemePreference,
} from './themeMode';

const STORAGE_KEY = 'futurehat.theme.mode';
const THEME_KEY = 'futurehat.theme.color';
const WALLPAPER_KEY = 'futurehat.theme.wallpaper';

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  /** Explicit user setting: system | light | dark | amoled */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Live OS light/dark (even when preference is forced light/dark). */
  systemScheme: SystemScheme;
  colorTheme: string;
  setColorTheme: (id: string) => void;
  wallpaper: string;
  setWallpaper: (id: string) => void;
  wallpaperColor: string | null;
  isPremium: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Hook value — still useful on iOS and as a secondary Android signal.
  const hookScheme = useColorScheme();

  const [systemScheme, setSystemScheme] = useState<SystemScheme>(() =>
    readAppearanceScheme(),
  );

  // Live multi-source subscription (native + Appearance + AppState).
  useEffect(() => {
    const unsub = subscribeSystemScheme((scheme) => {
      setSystemScheme((prev) => (prev === scheme ? prev : scheme));
    });
    return unsub;
  }, []);

  // Keep aligned with useColorScheme when it does update (iOS / stock Android).
  useEffect(() => {
    if (hookScheme == null) return;
    const next = normalizeSystemScheme(hookScheme);
    setSystemScheme((prev) => (prev === next ? prev : next));
  }, [hookScheme]);

  // Initial native poll (async) — fixes cold start on OEMs where Appearance is stale.
  useEffect(() => {
    let alive = true;
    void readSystemScheme().then((s) => {
      if (alive) setSystemScheme((prev) => (prev === s ? prev : s));
    });
    return () => {
      alive = false;
    };
  }, []);

  const premiumCtx = usePremiumOptional();
  const isPremium = premiumCtx?.isPremium ?? false;

  // DEFAULT = Follow System (WhatsApp). Light / Dark / AMOLED only after explicit choice.
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [colorTheme, setColorThemeState] = useState('default');
  const [wallpaper, setWallpaperState] = useState('default');
  const [hydrated, setHydrated] = useState(false);

  // Instant local hydrate — restore only if the user previously chose a mode.
  useEffect(() => {
    let alive = true;
    AsyncStorage.multiGet([STORAGE_KEY, THEME_KEY, WALLPAPER_KEY])
      .then((entries) => {
        if (!alive) return;
        const map = Object.fromEntries(entries);
        const m = map[STORAGE_KEY];
        if (isValidThemePreference(m)) setPreferenceState(m);
        else setPreferenceState(DEFAULT_THEME_PREFERENCE);
        if (map[THEME_KEY]) setColorThemeState(map[THEME_KEY]!);
        if (map[WALLPAPER_KEY]) setWallpaperState(map[WALLPAPER_KEY]!);
      })
      .catch(() => {
        if (alive) setPreferenceState(DEFAULT_THEME_PREFERENCE);
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Server reconcile: color theme + wallpaper only (never display mode).
  useEffect(() => {
    let alive = true;
    getPreferences(supabase)
      .then((prefs) => {
        if (!alive || !prefs) return;
        if (prefs.theme) {
          setColorThemeState(prefs.theme);
          AsyncStorage.setItem(THEME_KEY, prefs.theme).catch(() => {});
        }
        if (prefs.wallpaper) {
          setWallpaperState(prefs.wallpaper);
          AsyncStorage.setItem(WALLPAPER_KEY, prefs.wallpaper).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Explicit user choice from Appearance settings — only path that persists mode. */
  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const setColorTheme = useCallback((id: string) => {
    setColorThemeState(id);
    AsyncStorage.setItem(THEME_KEY, id).catch(() => {});
    updatePreferences(supabase, { theme: id }).catch(() => {});
  }, []);

  const setWallpaper = useCallback((id: string) => {
    setWallpaperState(id);
    AsyncStorage.setItem(WALLPAPER_KEY, id).catch(() => {});
    updatePreferences(supabase, { wallpaper: id }).catch(() => {});
  }, []);

  // Forced Light/Dark/AMOLED ignore systemScheme; Follow System tracks it live.
  const mode = resolveThemeMode(preference, systemScheme);

  const value = useMemo<ThemeContextValue>(() => {
    const base = palettes[mode];
    const colors = resolveThemePalette(colorTheme, base, isPremium);
    return {
      colors,
      mode,
      preference,
      setPreference,
      systemScheme,
      colorTheme,
      setColorTheme,
      wallpaper,
      setWallpaper,
      wallpaperColor: resolveWallpaperColor(wallpaper, isPremium),
      isPremium,
    };
  }, [
    mode,
    preference,
    systemScheme,
    colorTheme,
    wallpaper,
    isPremium,
    hydrated,
    setPreference,
    setColorTheme,
    setWallpaper,
  ]);

  // Native system bars — update whenever the effective palette flips.
  // Avoids white/black flash on the nav bar when Follow System toggles.
  const chromeKey = useRef<string>('');
  useEffect(() => {
    const { colors } = value;
    const key = `${mode}|${colors.header}|${colors.bg}|${colors.isLight}`;
    if (chromeKey.current === key) return;
    chromeKey.current = key;
    void applySystemChrome({
      isLightSurfaces: colors.isLight,
      // Header green in light (WhatsApp) / dark header surface in dark.
      statusBarColor: colors.header,
      navigationBarColor: colors.bg,
    });
  }, [value, mode]);

  return (
    <ThemeContext.Provider value={value}>
      {/* Animated status-bar glyph flip; Android colors come from setSystemChrome. */}
      <StatusBar style={value.colors.isLight ? 'dark' : 'light'} animated />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/** Convenience: most screens only need the active palette. */
export function useColors(): Palette {
  return useTheme().colors;
}

/** Live OS scheme (for Appearance screen swatches even when forced mode). */
export function useSystemScheme(): SystemScheme {
  return useTheme().systemScheme;
}
