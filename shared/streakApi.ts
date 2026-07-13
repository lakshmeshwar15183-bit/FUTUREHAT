// Lumixo — Streak System data layer (framework-agnostic; web + mobile share it).
//
// Relationship streaks between the TWO users of a direct conversation. Everything
// authoritative — the score, the +1/-3, tier, milestones (Diamond premium, the
// Moderator reward, Hall of Legends) — is computed and enforced in Postgres
// (supabase/migrations/0029_streaks.sql). This module only READS that state and
// MIRRORS the tier mapping so the UI can render the emoji from the authoritative
// score with no extra round-trip. It can NEVER change a score: the streak tables
// are SELECT-only under RLS and all mutations are SECURITY DEFINER RPCs.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  UUID,
  StreakSummary,
  StreakDetail,
  HallOfLegendsEntry,
} from './types.js';

// ── Tier ladder — EXACT mirror of public.streak_tier() in 0029_streaks.sql ──────
// Keep this in lockstep with the SQL function; the DB remains the source of truth
// (it stamps `tier` on every row it returns), and this is used for local rendering
// and the Levels UI.
export interface StreakTier {
  emoji: string;
  label: string;
  min: number;      // inclusive
  max: number;      // inclusive (Infinity for the top tier)
}

export const STREAK_TIERS: StreakTier[] = [
  { emoji: '🎏', label: 'Koi',        min: 1,   max: 16 },
  { emoji: '💙', label: 'Blue Heart', min: 17,  max: 44 },
  { emoji: '❤️', label: 'Red Heart',  min: 45,  max: 99 },
  { emoji: '💜', label: 'Purple Heart', min: 100, max: 199 },
  { emoji: '🎖️', label: 'Medal',      min: 200, max: 364 },
  { emoji: '💎', label: 'Diamond',    min: 365, max: 365 },
  { emoji: '🪙', label: 'Coin',       min: 366, max: 729 },
  { emoji: '🏆', label: 'Hall of Legends', min: 730, max: Infinity },
];

/** Emoji for a score (mirror of SQL streak_tier). 0 or below ⇒ '' (no tier). */
export function emojiForScore(score: number): string {
  if (!score || score <= 0) return '';
  const t = STREAK_TIERS.find((x) => score >= x.min && score <= x.max);
  return t ? t.emoji : '🏆';
}

/** Full tier for a score, or null when there is no streak yet (score ≤ 0). */
export function tierForScore(score: number): StreakTier | null {
  if (!score || score <= 0) return null;
  return STREAK_TIERS.find((x) => score >= x.min && score <= x.max) ?? STREAK_TIERS[STREAK_TIERS.length - 1];
}

/** The next tier above `score`, for "progress to next tier" UI. Null at the top. */
export function nextTier(score: number): StreakTier | null {
  const idx = STREAK_TIERS.findIndex((x) => score >= x.min && score <= x.max);
  if (idx < 0) return STREAK_TIERS[0];
  return STREAK_TIERS[idx + 1] ?? null;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** All of the caller's streaks (one round-trip). Powers the chat-list emojis. */
export async function getMyStreaks(client: SupabaseClient): Promise<StreakSummary[]> {
  const { data, error } = await client.rpc('get_my_streaks');
  if (error) throw error;
  return (data as StreakSummary[]) ?? [];
}

/** Map of conversation_id → StreakSummary, for O(1) chat-row lookup. */
export function indexStreaksByConversation(list: StreakSummary[]): Record<UUID, StreakSummary> {
  const out: Record<UUID, StreakSummary> = {};
  for (const s of list) out[s.conversation_id] = s;
  return out;
}

/** Full detail (score, milestones, recent ledger events) for one pair. */
export async function getStreak(client: SupabaseClient, conversationId: UUID): Promise<StreakDetail> {
  const { data, error } = await client.rpc('get_streak', { p_conversation: conversationId });
  if (error) throw error;
  return data as StreakDetail;
}

/** Paginated Hall of Legends (🏆) pairs. `before` = keyset by achieved_at. */
export async function getHallOfLegends(
  client: SupabaseClient,
  opts: { limit?: number; before?: string | null } = {},
): Promise<HallOfLegendsEntry[]> {
  const { data, error } = await client.rpc('get_hall_of_legends', {
    p_limit: opts.limit ?? 50,
    p_before: opts.before ?? null,
  });
  if (error) throw error;
  return (data as HallOfLegendsEntry[]) ?? [];
}

// ── Live signal + client-side catch-up (never authoritative) ───────────────────

/**
 * Tell the server "I just did something qualifying in this chat" so the
 * waiting-on-peer / done-today UI stays live. The SERVER re-derives qualification
 * from the real message/call tables — this call trusts only the conversation id
 * and can NOT move the score. Safe to call fire-and-forget after a send/call end.
 * Returns today's live flags, or null on any error (never throws to the caller).
 */
export async function recordStreakActivity(
  client: SupabaseClient,
  conversationId: UUID,
): Promise<{ completed_today: boolean; i_qualified?: boolean } | null> {
  try {
    const { data, error } = await client.rpc('record_streak_activity', { p_conversation: conversationId });
    if (error) return null;
    return data as { completed_today: boolean };
  } catch {
    return null;
  }
}

/**
 * Client safety net: ask the server to finalise any of the CALLER's own pending
 * streak days (idempotent catch-up), mirroring dispatchDueMessages(). The daily
 * pg_cron job does this for everyone; this just flushes the current user's pairs
 * on app launch so scores are correct without waiting for midnight. Server remains
 * authoritative; the client never computes points. Returns pairs processed.
 */
export async function processMyStreaks(client: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await client.rpc('process_my_streaks', { p_day: null });
    if (error) return 0;
    return typeof data === 'number' ? data : 0;
  } catch {
    return 0;
  }
}

// ── Admin audit (admin-gated server-side) ──────────────────────────────────────
export async function getStreakAudit(client: SupabaseClient, limit = 200): Promise<{
  milestones: any[]; mod_grants: any[]; hall_of_legends: any[]; recent_events: any[];
}> {
  const { data, error } = await client.rpc('admin_streak_audit', { p_limit: limit });
  if (error) throw error;
  return data as { milestones: any[]; mod_grants: any[]; hall_of_legends: any[]; recent_events: any[] };
}

// ── Realtime ───────────────────────────────────────────────────────────────────
// Monotonic suffix so every subscription gets a UNIQUE channel name. Supabase's
// removeChannel() is async: if we reused a fixed name ('streaks-changes'), a fast
// re-mount (leave Streaks → come back) could call .channel(name) BEFORE the prior
// channel finished tearing down, get the SAME already-subscribed channel back, and
// then `.on('postgres_changes', …)` throws "cannot add callbacks after subscribe()"
// — crashing the screen. A unique name per call structurally prevents that collision.
let streakChannelSeq = 0;

/**
 * One debounced channel over the tables that change streak state (`streaks` +
 * `streak_events`) → invokes onChange to reload get_my_streaks(). Mirrors
 * subscribeCallChanges() in callsApi. Always clean up via the returned unsubscribe.
 */
export function subscribeStreakChanges(
  client: SupabaseClient,
  onChange: () => void,
): { unsubscribe: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => { if (timer) clearTimeout(timer); timer = setTimeout(onChange, 300); };
  const channel = client
    .channel(`streaks-changes-${++streakChannelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'streaks' }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'streak_events' }, fire)
    .subscribe();
  return {
    unsubscribe: () => { if (timer) clearTimeout(timer); client.removeChannel(channel); },
  };
}
