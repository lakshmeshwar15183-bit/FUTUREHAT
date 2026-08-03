// Lumixo — Call settings. Stored in the existing `user_preferences.extra`
// jsonb bag under the `calls` namespace (mirrors shared/privacyApi.ts), so no new
// table is required. These are client-side call preferences surfaced by the Calls
// module's "Call Settings" screen.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallSettings } from './types.js';
import { getPreferences, updatePreferences } from './premiumApi.js';

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  silence_unknown: false,
  ringtone: true,
  vibrate: true,
  noise_suppression: true,
  echo_cancellation: true,
};

function extraOf(prefs: any): Record<string, any> {
  return (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
}

export async function getCallSettings(client: SupabaseClient): Promise<CallSettings> {
  const prefs = await getPreferences(client);
  return { ...DEFAULT_CALL_SETTINGS, ...(extraOf(prefs).calls ?? {}) };
}

export async function setCallSettings(client: SupabaseClient, patch: Partial<CallSettings>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = { ...extra, calls: { ...DEFAULT_CALL_SETTINGS, ...(extra.calls ?? {}), ...patch } };
  return updatePreferences(client, { extra: next } as any);
}
