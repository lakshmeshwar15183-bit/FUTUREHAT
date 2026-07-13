// Lumixo mobile — theme provider. Holds the active palette, persists the
// user's choices, and exposes a hook every screen uses to build styles.
//
// Two independent dimensions compose into the live palette:
//  1. MODE (dark/light/amoled/system) — device-local, AsyncStorage, always available.
//  2. COLOR THEME (Classic + 5 premium named palettes) + WALLPAPER — server prefs
//     shared with web (`user_preferences.theme` / `.wallpaper`), premium-gated.
// When a premium color theme is active it overrides the mode palette (web parity).
//
// Premium flag comes from PremiumProvider so purchase unlocks themes instantly
// without remounting ThemeProvider or the navigation tree.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { palettes, type Palette, type ThemeMode } from './palettes';
import { resolveThemePalette, resolveWallpaperColor } from './appearance';
import { supabase } from '../lib/supabase';
import { getPreferences, updatePreferences } from '../lib/shared';
import { usePremiumOptional } from '../premium';

const STORAGE_KEY = 'futurehat.theme.mode';
const THEME_KEY = 'futurehat.theme.color'; // local mirror of user_preferences.theme
const WALLPAPER_KEY = 'futurehat.theme.wallpaper';

/** 'system' follows the OS; the others force a palette. */
export type ThemePreference = ThemeMode | 'system';

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Named color theme id (web parity). 'default' = use the mode palette. */
  colorTheme: string;
  setColorTheme: (id: string) => void;
  /** Chat wallpaper id (web parity). */
  wallpaper: string;
  setWallpaper: (id: string) => void;
  /** Resolved chat-background tint, gated by premium. null = no override. */
  wallpaperColor: string | null;
  isPremium: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const premiumCtx = usePremiumOptional();
  const isPremium = premiumCtx?.isPremium ?? false;

  const [preference, setPreferenceState] = useState<ThemePreference>('dark');
  const [colorTheme, setColorThemeState] = useState('default');
  const [wallpaper, setWallpaperState] = useState('default');

  // Instant local hydrate (no network wait), then reconcile with the server prefs.
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, THEME_KEY, WALLPAPER_KEY]).then((entries) => {
      const map = Object.fromEntries(entries);
      const m = map[STORAGE_KEY];
      if (m === 'dark' || m === 'light' || m === 'amoled' || m === 'system') setPreferenceState(m);
      if (map[THEME_KEY]) setColorThemeState(map[THEME_KEY]!);
      if (map[WALLPAPER_KEY]) setWallpaperState(map[WALLPAPER_KEY]!);
    });
  }, []);

  // Server reconcile: color theme + wallpaper only (premium lives in PremiumProvider).
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

  const mode: ThemeMode =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

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
  }, [mode, preference, colorTheme, wallpaper, isPremium]);

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
