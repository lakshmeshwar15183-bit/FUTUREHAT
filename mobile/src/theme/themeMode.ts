// Pure theme-mode helpers (no React Native imports — safe for unit tests).
import type { ThemeMode } from './palettes';

export type ThemePreference = ThemeMode | 'system';

/**
 * WhatsApp-class default: match the device light/dark setting.
 * Settings may override to Light / Dark / AMOLED — that is always an explicit
 * user choice and is persisted only when the user picks it.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/**
 * Pure: map preference + OS scheme → concrete palette mode.
 *
 * Follow System must only go dark when the OS explicitly reports dark.
 * Many Android OEMs (Realme/OPPO/Xiaomi) report `null` while the phone is
 * in light mode — treating null as dark made the app "auto-switch to dark"
 * even though the device was light.
 */
export function resolveThemeMode(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null | undefined,
): ThemeMode {
  if (preference === 'system') {
    if (systemScheme === 'dark') return 'dark';
    // light | null | undefined → light
    return 'light';
  }
  return preference;
}

/** Normalize OS scheme; never invent dark when the OS is silent. */
export function normalizeSystemScheme(
  scheme: 'light' | 'dark' | null | undefined,
): 'light' | 'dark' {
  return scheme === 'dark' ? 'dark' : 'light';
}

export function isValidThemePreference(v: string | null | undefined): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark' || v === 'amoled';
}
