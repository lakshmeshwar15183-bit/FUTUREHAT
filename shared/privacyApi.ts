// FUTUREHAT — privacy visibility + chat/general settings. These are stored in
// the existing `user_preferences.extra` jsonb bag (namespaced), so no new table
// is required. Visibility values are persisted for every client; server-side
// enforcement of cross-user visibility (e.g. hiding last-seen from others) is a
// follow-up RLS/view task noted in the security review.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatusAudience, UUID } from './types.js';
import { getPreferences, updatePreferences } from './premiumApi.js';

export type Visibility = 'everyone' | 'contacts' | 'nobody';
export type FontSize = 'small' | 'medium' | 'large';
export type MediaQuality = 'auto' | 'high' | 'data_saver';

export interface PrivacySettings {
  lastSeen: Visibility;
  profilePhoto: Visibility;
  about: Visibility;
  links: Visibility;
  status: Visibility;
  groups: Visibility;
  calls: Visibility;
  avatar: Visibility;
  readReceipts: boolean;
}

export interface ChatSettings {
  enterToSend: boolean;
  fontSize: FontSize;
  mediaVisibility: boolean;        // show newly downloaded media in gallery
  mediaUploadQuality: MediaQuality;
  autoDownload: boolean;
  voiceTranscripts: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  lastSeen: 'everyone', profilePhoto: 'everyone', about: 'everyone', links: 'everyone',
  status: 'contacts', groups: 'everyone', calls: 'everyone', avatar: 'everyone',
  readReceipts: true,
};

export const DEFAULT_CHAT: ChatSettings = {
  enterToSend: true, fontSize: 'medium', mediaVisibility: true,
  mediaUploadQuality: 'auto', autoDownload: true, voiceTranscripts: false,
};

function extraOf(prefs: any): Record<string, any> {
  return (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
}

export async function getPrivacy(client: SupabaseClient): Promise<PrivacySettings> {
  const prefs = await getPreferences(client);
  return { ...DEFAULT_PRIVACY, ...(extraOf(prefs).privacy ?? {}) };
}
export async function setPrivacy(client: SupabaseClient, patch: Partial<PrivacySettings>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = { ...extra, privacy: { ...DEFAULT_PRIVACY, ...(extra.privacy ?? {}), ...patch } };
  return updatePreferences(client, { extra: next } as any);
}

// ── Status audience (WhatsApp-style privacy default) ─────────────────────────
// The user's default audience for new statuses + the member list for the
// Except / Only-Share-With modes. Persisted in the existing user_preferences
// .extra jsonb bag (namespaced `statusAudience`), so no new table is needed.
// Per-post enforcement is snapshotted server-side into public.status_audience.
export interface StatusAudiencePref {
  audience: StatusAudience;
  memberIds: UUID[];
}

export const DEFAULT_STATUS_AUDIENCE: StatusAudiencePref = { audience: 'everyone', memberIds: [] };

export async function getStatusAudiencePref(client: SupabaseClient): Promise<StatusAudiencePref> {
  const prefs = await getPreferences(client);
  const saved = extraOf(prefs).statusAudience ?? {};
  return { ...DEFAULT_STATUS_AUDIENCE, ...saved };
}

export async function setStatusAudiencePref(client: SupabaseClient, patch: Partial<StatusAudiencePref>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = {
    ...extra,
    statusAudience: { ...DEFAULT_STATUS_AUDIENCE, ...(extra.statusAudience ?? {}), ...patch },
  };
  return updatePreferences(client, { extra: next } as any);
}

export async function getChatSettings(client: SupabaseClient): Promise<ChatSettings> {
  const prefs = await getPreferences(client);
  return { ...DEFAULT_CHAT, ...(extraOf(prefs).chat ?? {}) };
}
export async function setChatSettings(client: SupabaseClient, patch: Partial<ChatSettings>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = { ...extra, chat: { ...DEFAULT_CHAT, ...(extra.chat ?? {}), ...patch } };
  return updatePreferences(client, { extra: next } as any);
}
