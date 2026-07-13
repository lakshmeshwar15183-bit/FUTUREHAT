// Lumixo mobile — auth callback URL helpers.
// Supabase email links (reset password / magic link / email confirm) redirect
// back to a URL we control. Production MUST use the HTTPS site URL so links
// never open localhost / Expo Go addresses on another device.
//
// Configure Supabase → Authentication → URL Configuration:
//   Site URL:                 https://<your-production-host>
//   Additional redirect URLs: https://<your-production-host>/reset-password
//                             futurehat://reset-password
//                             lumixo://reset-password
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** Path we route the recovery deep link to. */
export const RESET_PASSWORD_PATH = 'reset-password';

/** App schemes that installed builds accept (AndroidManifest + app.json). */
const APP_SCHEMES = ['futurehat', 'lumixo', 'dev.lakshmeshwar.futurehat'] as const;

function isUnsafeRedirect(url: string): boolean {
  return /localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|exp:\/\/|exps:\/\//i.test(url);
}

/** Production HTTPS site (universal / app link). */
export function resetPasswordSiteUrl(): string | null {
  const site =
    process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/+$/, '') ||
    (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl?.replace(/\/+$/, '');
  return site ? `${site}/${RESET_PASSWORD_PATH}` : null;
}

/** Custom-scheme deep link for the installed APK (never uses Expo Go host). */
export function resetPasswordAppSchemeUrl(): string {
  // Prefer the first scheme that matches app.json; futurehat is the registered one.
  return `${APP_SCHEMES[0]}://${RESET_PASSWORD_PATH}`;
}

/**
 * Redirect URL sent to Supabase for password-reset emails.
 *
 * Priority:
 *  1) HTTPS site URL (App Link → opens app if installed, else web)
 *  2) Custom app scheme for standalone builds
 *  3) Linking.createURL only when it is NOT a localhost/Expo Go URL
 *
 * This prevents the production bug where reset emails open localhost:8081.
 */
export function resetPasswordRedirectUrl(): string {
  const site = resetPasswordSiteUrl();
  if (site && !isUnsafeRedirect(site)) return site;

  // Standalone / production native: always use the custom scheme, never exp://
  const appOwnership = (Constants as any).appOwnership as string | null | undefined;
  const isExpoGo = appOwnership === 'expo';
  if (!isExpoGo && Platform.OS !== 'web') {
    return resetPasswordAppSchemeUrl();
  }

  try {
    const dynamic = Linking.createURL(RESET_PASSWORD_PATH);
    if (dynamic && !isUnsafeRedirect(dynamic)) return dynamic;
  } catch {
    /* fall through */
  }

  // Last resort — custom scheme (works once the production app is installed).
  return resetPasswordAppSchemeUrl();
}

/** Extract recovery tokens from a deep link (fragment or query). */
export function parseRecoveryLink(url: string | null | undefined):
  | { accessToken: string; refreshToken: string }
  | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const raw =
    hashIndex >= 0 ? url.slice(hashIndex + 1)
    : queryIndex >= 0 ? url.slice(queryIndex + 1)
    : '';
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const type = params.get('type');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  // Accept type=recovery; also tolerate missing type when tokens are present
  // (some Supabase email templates omit type in the fragment).
  if ((!type || type === 'recovery') && accessToken && refreshToken) {
    return { accessToken, refreshToken };
  }
  return null;
}

export function isRecoveryLink(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes(`/${RESET_PASSWORD_PATH}`)) return true;
  if (url.includes(`://${RESET_PASSWORD_PATH}`)) return true;
  return !!parseRecoveryLink(url);
}
