// FUTUREHAT mobile — theme provider. Holds the active palette, persists the
// user's choice, and exposes a hook every screen uses to build styles.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { palettes, type Palette, type ThemeMode } from './palettes';

const STORAGE_KEY = 'futurehat.theme.mode';

/** 'system' follows the OS; the others force a palette. */
export type ThemePreference = ThemeMode | 'system';

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'amoled' || v === 'system') {
        setPreferenceState(v);
      }
    });
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  };

  const mode: ThemeMode =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: palettes[mode], mode, preference, setPreference }),
    [mode, preference],
  );

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
