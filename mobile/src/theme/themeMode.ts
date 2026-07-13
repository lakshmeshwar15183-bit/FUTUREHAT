// Pure theme-mode helpers (no React Native imports — safe for unit tests).
import type { ThemeMode } from './palettes';

export type ThemePreference = ThemeMode | 'system';

/** Pure: map preference + OS scheme → concrete palette mode. */
export function resolveThemeMode(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeMode {
  if (preference === 'system') {
    return systemScheme === 'light' ? 'light' : 'dark';
  }
  return preference;
}

export function isValidThemePreference(v: string | null | undefined): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark' || v === 'amoled';
}
