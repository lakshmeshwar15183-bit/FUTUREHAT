// Pure theme-mode helpers (no React Native imports — safe for unit tests).
import type { ThemeMode } from './palettes';

export type ThemePreference = ThemeMode | 'system';

/**
 * WhatsApp-class default: match the device light/dark setting.
 * Settings may override to Light / Dark / AMOLED — that is always an explicit
 * user choice and is persisted only when the user picks it.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** Pure: map preference + OS scheme → concrete palette mode. */
export function resolveThemeMode(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeMode {
  if (preference === 'system') {
    // Unknown OS scheme → dark (common Android/OLED safe default).
    return systemScheme === 'light' ? 'light' : 'dark';
  }
  return preference;
}

export function isValidThemePreference(v: string | null | undefined): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark' || v === 'amoled';
}
