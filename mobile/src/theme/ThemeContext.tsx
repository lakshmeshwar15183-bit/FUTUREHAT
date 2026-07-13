// Lumixo mobile — theme provider.
//
// DEFAULT: Follow System (WhatsApp-class). First launch matches the device
// appearance with no manual step. Runtime OS light/dark changes update live
// without remounting navigation or auth.
//
// Dimensions:
//  1. MODE preference: system | light | dark | amoled (device-local AsyncStorage)
//  2. COLOR THEME + WALLPAPER (server prefs, premium-gated)
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme, type ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { palettes, type Palette, type ThemeMode } from './palettes';
import {
  resolveThemeMode,
  isValidThemePreference,
  type ThemePreference,
} from './themeMode';
import { resolveThemePalette, resolveWallpaperColor } from './appearance';
import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { usePremiumOptional } from '../premium';

export type { ThemePreference };
export { resolveThemeMode, isValidThemePreference } from './themeMode';

const STORAGE_KEY = 'futurehat.theme.mode';
const THEME_KEY = 'futurehat.theme.color';
const WALLPAPER_KEY = 'futurehat.theme.wallpaper';

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  colorTheme: string;
  setColorTheme: (id: string) => void;
  wallpaper: string;
  setWallpaper: (id: string) => void;
  wallpaperColor: string | null;
  isPremium: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Live system scheme — updates when the user toggles OS appearance.
  const systemFromHook = useColorScheme();
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(() => Appearance.getColorScheme());

  // Keep in sync with Appearance API (belt + useColorScheme for all platforms).
  useEffect(() => {
    setSystemScheme(systemFromHook ?? Appearance.getColorScheme());
  }, [systemFromHook]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const premiumCtx = usePremiumOptional();
  const isPremium = premiumCtx?.isPremium ?? false;

  // DEFAULT = Follow System (WhatsApp). No dark hard-code for new users.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [colorTheme, setColorThemeState] = useState('default');
  const [wallpaper, setWallpaperState] = useState('default');
  const [hydrated, setHydrated] = useState(false);

  // Instant local hydrate — if user previously chose light/dark/amoled, restore.
  // Missing key → stay on 'system' (do not write until user picks).
  useEffect(() => {
    let alive = true;
    AsyncStorage.multiGet([STORAGE_KEY, THEME_KEY, WALLPAPER_KEY])
      .then((entries) => {
        if (!alive) return;
        const map = Object.fromEntries(entries);
        const m = map[STORAGE_KEY];
        if (isValidThemePreference(m)) setPreferenceState(m);
        if (map[THEME_KEY]) setColorThemeState(map[THEME_KEY]!);
        if (map[WALLPAPER_KEY]) setWallpaperState(map[WALLPAPER_KEY]!);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Server reconcile: color theme + wallpaper only.
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

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  };

  const setColorTheme = (id: string) => {
    setColorThemeState(id);
    AsyncStorage.setItem(THEME_KEY, id).catch(() => {});
    updatePreferences(supabase, { theme: id }).catch(() => {});
  };

  const setWallpaper = (id: string) => {
    setWallpaperState(id);
    AsyncStorage.setItem(WALLPAPER_KEY, id).catch(() => {});
    updatePreferences(supabase, { wallpaper: id }).catch(() => {});
  };

  const mode = resolveThemeMode(preference, systemScheme);

  const value = useMemo<ThemeContextValue>(() => {
    const base = palettes[mode];
    const colors = resolveThemePalette(colorTheme, base, isPremium);
    return {
      colors,
      mode,
      preference,
      setPreference,
      colorTheme,
      setColorTheme,
      wallpaper,
      setWallpaper,
      wallpaperColor: resolveWallpaperColor(wallpaper, isPremium),
      isPremium,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, preference, colorTheme, wallpaper, isPremium, hydrated]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
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
