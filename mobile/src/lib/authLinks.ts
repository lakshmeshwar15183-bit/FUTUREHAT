// FUTUREHAT mobile — auth callback URL helpers.
// Supabase email links (reset password / magic link / email confirm) redirect
// back to a URL we control. That URL has to work in EVERY environment we run
// in — Expo Go (exp://…), dev-client, standalone `futurehat://` builds, and
// (optionally) the https universal-link. `Linking.createURL()` handles the
// first three; the https fallback comes from EXPO_PUBLIC_SITE_URL.
//
// The URL you use here MUST also be added to Supabase → Authentication →
// URL Configuration → Additional Redirect URLs. If it isn't, the auth
// server strips the redirectTo and falls back to the project's Site URL,
// which is why the link "opens the wrong page".
import * as Linking from 'expo-linking';

/** Path we route the recovery deep link to. Kept as a constant so the app-side
 *  route matcher and the outgoing redirectTo can never drift apart. */
export const RESET_PASSWORD_PATH = 'reset-password';

/** Build a redirect URL for the given auth callback path. Prefers the app-scheme
 *  URL (works even without network / on airplane mode). If EXPO_PUBLIC_SITE_URL
 *  is set we also expose an https variant so consumers can pick the right one
 *  per platform. */
export function resetPasswordRedirectUrl(): string {
  // Linking.createURL yields e.g. `futurehat://reset-password` in a standalone
  // build and `exp://192.168.x.x:8081/--/reset-password` under Expo Go, so the
  // same code path works in every environment without extra config.
  return Linking.createURL(RESET_PASSWORD_PATH);
}

/** Optional HTTPS fallback (universal link) — only usable when EXPO_PUBLIC_SITE_URL
 *  is set AND the web app hosts a matching `/reset-password` route. Callers can
 *  attach this as an alternative in the redirect email template or use it when
 *  the app scheme is known to fail. */
export function resetPasswordSiteUrl(): string | null {
  const site = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  return site ? `${site}/${RESET_PASSWORD_PATH}` : null;
}

/** Extract the recovery tokens from a deep link. Supabase puts them in the
 *  URL FRAGMENT (`#access_token=…&refresh_token=…&type=recovery`) — never the
 *  query string. `expo-linking`'s parse() only reads the query, so we do this
 *  by hand. Returns null when the URL isn't a recovery callback. */
export function parseRecoveryLink(url: string | null | undefined):
  | { accessToken: string; refreshToken: string }
  | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  // Tokens may show up in either the fragment (Supabase default) or the query,
  // depending on the email template / auth version. Handle both defensively.
  const raw =
    hashIndex >= 0 ? url.slice(hashIndex + 1)
    : queryIndex >= 0 ? url.slice(queryIndex + 1)
    : '';
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const type = params.get('type');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (type !== 'recovery' || !accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** Does the URL look like the recovery callback (regardless of token validity)?
 *  Useful for cold-start routing when we want to show the ResetPassword screen
 *  even if the tokens turn out to be expired (that's a UX message, not a
 *  wrong-route bug). */
export function isRecoveryLink(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes(`/${RESET_PASSWORD_PATH}`)) return true;
  if (url.includes(`://${RESET_PASSWORD_PATH}`)) return true;
  return !!parseRecoveryLink(url);
}
