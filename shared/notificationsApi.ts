// FUTUREHAT — Notification settings (WhatsApp-style). Stored in the existing
// `user_preferences.extra.notifications` jsonb bag (mirrors shared/privacyApi.ts),
// so they sync with the user's profile and restore on any device after login.
// Tone/ringtone default to 'default' = the DEVICE SYSTEM DEFAULT sound; a custom
// URI is only stored if the user explicitly picks one via Android's channel
// settings. No sounds are bundled with the app.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationSettings } from './types.js';
import { getPreferences, updatePreferences } from './premiumApi.js';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  // MESSAGE
  messageMute: false,
  messageTone: 'default',
  messageVibrate: true,
  messagePopup: true,
  messageHighPriority: true,
  messagePreview: true,
  // CALLS
  callRingtone: 'default',
  callVibrate: true,
  callFullScreen: true,
  callFlash: false,
  // STATUS
  statusMute: false,
  // GROUPS
  groupTone: 'default',
  groupVibrate: true,
  groupMute: false,
};

function extraOf(prefs: any): Record<string, any> {
  return (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
}

export async function getNotificationSettings(client: SupabaseClient): Promise<NotificationSettings> {
  const prefs = await getPreferences(client);
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(extraOf(prefs).notifications ?? {}) };
}

export async function setNotificationSettings(client: SupabaseClient, patch: Partial<NotificationSettings>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = {
    ...extra,
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, ...(extra.notifications ?? {}), ...patch },
  };
  return updatePreferences(client, { extra: next } as any);
}

/** Human label for a tone value in the settings UI. */
export function toneLabel(value: string | undefined): string {
  return !value || value === 'default' ? 'Default (System)' : 'Custom';
}
