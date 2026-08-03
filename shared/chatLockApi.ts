// Lumixo — Chat Lock data-access (0027). Framework-agnostic; web + mobile share it.
//
// A locked chat is secured by the DEVICE's own secure authentication (biometric /
// device PIN) — NEVER by a secret stored inside Lumixo. This layer only tracks:
//   • WHICH conversations the user locked   → locked_conversations (per-user rows)
//   • auto-lock timing + master enable       → user_preferences.extra.chatLock
// so the choice + preferences sync across the user's devices. The actual
// authentication happens on-device (see mobile ChatLock security module).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, ChatLockSettings } from './types.js';
import { getPreferences, updatePreferences } from './premiumApi.js';

export const DEFAULT_CHAT_LOCK: ChatLockSettings = { enabled: false, autoLockMs: 0 };

// ── Locked conversations (per-user, synced) ─────────────────────────────────────

export async function getLockedIds(client: SupabaseClient): Promise<UUID[]> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await client
    .from('locked_conversations')
    .select('conversation_id')
    .eq('user_id', auth.user.id);
  // Surface a genuine read failure (offline / table not yet migrated) instead of
  // masking it as an empty list — callers reconcile "empty" and "unavailable"
  // differently (an unavailable read must NOT wipe locally-locked chats). Every
  // current caller already wraps this in .catch, so throwing is safe.
  if (error) throw error;
  return (data || []).map((r: any) => r.conversation_id);
}

export async function lockConversation(client: SupabaseClient, conversationId: UUID) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('locked_conversations')
    .upsert({ user_id: auth.user.id, conversation_id: conversationId });
  return { error };
}

export async function unlockConversation(client: SupabaseClient, conversationId: UUID) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: new Error('not authenticated') };
  const { error } = await client
    .from('locked_conversations')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('conversation_id', conversationId);
  return { error };
}

// ── Chat Lock settings (synced via user_preferences.extra.chatLock) ─────────────

function extraOf(prefs: any): Record<string, any> {
  return (prefs && typeof prefs.extra === 'object' && prefs.extra) ? prefs.extra : {};
}

export async function getChatLockSettings(client: SupabaseClient): Promise<ChatLockSettings> {
  const prefs = await getPreferences(client);
  return { ...DEFAULT_CHAT_LOCK, ...(extraOf(prefs).chatLock ?? {}) };
}

export async function setChatLockSettings(client: SupabaseClient, patch: Partial<ChatLockSettings>) {
  const prefs = await getPreferences(client);
  const extra = extraOf(prefs);
  const next = {
    ...extra,
    chatLock: { ...DEFAULT_CHAT_LOCK, ...(extra.chatLock ?? {}), ...patch },
  };
  return updatePreferences(client, { extra: next } as any);
}

/** Human label for the auto-lock timing options in the settings UI. */
export function autoLockLabel(ms: number): string {
  switch (ms) {
    case 0: return 'Immediately after exit';
    case 60000: return 'After 1 minute';
    case 300000: return 'After 5 minutes';
    case 1800000: return 'After 30 minutes';
    default: return 'Immediately after exit';
  }
}
