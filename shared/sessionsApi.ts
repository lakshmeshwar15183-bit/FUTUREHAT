// Lumixo — WhatsApp-style device session management.
// Framework-agnostic (web + mobile). Backs the 0067_device_sessions migration.
//
// Each login gets a row in public.user_sessions keyed on the JWT session_id
// claim (stable across token refreshes). register_session() heartbeats the row
// and enforces the 2-phone limit server-side; revoked devices self-enforce via
// realtime + foreground re-register (soft revoke) on top of the best-effort
// server-side auth.sessions kill.
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type SessionPlatform = 'android' | 'ios' | 'web';
export type RevokedReason = 'phone_limit' | 'remote' | 'logout_all';

export type UserSession = {
  session_id: string;
  user_id: string;
  platform: SessionPlatform;
  device_label: string | null;
  created_at: string;
  last_seen: string;
  revoked_at: string | null;
  revoked_reason: RevokedReason | null;
};

export type RegisterSessionResult = { revoked: boolean; reason?: RevokedReason | null };

/** Register/heartbeat this session. Returns { revoked: true } if THIS session
 *  was revoked (phone limit or remote sign-out) and the client must sign out. */
export async function registerSession(
  client: SupabaseClient,
  platform: SessionPlatform,
  deviceLabel?: string | null,
): Promise<RegisterSessionResult> {
  try {
    const { data, error } = await client.rpc('register_session', {
      p_platform: platform,
      p_device_label: deviceLabel ?? null,
    });
    if (error) return { revoked: false }; // never bounce a session on RPC failure
    const d = (data ?? {}) as { revoked?: boolean; reason?: RevokedReason };
    return { revoked: d.revoked === true, reason: d.reason ?? null };
  } catch {
    return { revoked: false };
  }
}

/** Active (non-revoked) sessions for the signed-in user, freshest first. */
export async function listMySessions(client: SupabaseClient): Promise<UserSession[]> {
  const { data } = await client
    .from('user_sessions')
    .select('*')
    .is('revoked_at', null)
    .order('last_seen', { ascending: false });
  return (data ?? []) as UserSession[];
}

/** Sign out one of my OTHER devices. Server refuses the caller's own session. */
export async function revokeSession(client: SupabaseClient, sessionId: string) {
  const { error } = await client.rpc('revoke_session', { p_session_id: sessionId });
  return { error };
}

/** Remove own registry row on normal local sign-out (fire-and-forget). */
export async function unregisterSession(client: SupabaseClient): Promise<void> {
  try {
    await client.rpc('unregister_session');
  } catch {
    /* best-effort */
  }
}

/** Notify `onRevoked` when THIS session's row gets revoked (or deleted after
 *  a revoke we missed). RLS limits the stream to the owner's rows. */
export function subscribeToSessionRevoked(
  client: SupabaseClient,
  sessionId: string,
  onRevoked: (reason: RevokedReason | null) => void,
): RealtimeChannel {
  return client
    .channel(`session-revoked:${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'user_sessions', filter: `session_id=eq.${sessionId}` },
      (payload: any) => {
        const row = payload.new ?? {};
        if (row.revoked_at) onRevoked((row.revoked_reason as RevokedReason) ?? null);
      },
    )
    .subscribe();
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/** Friendly sign-out explanation for a revoke reason. */
export function revokedSignOutMessage(reason: RevokedReason | null | undefined): string {
  if (reason === 'phone_limit') {
    return 'You were signed out because your account was signed in on another phone. Lumixo allows 2 phones at a time.';
  }
  if (reason === 'logout_all') {
    return 'You were signed out of all devices.';
  }
  return 'You were signed out from another device.';
}

/** "Chrome · Windows"-style label from a browser user agent. */
export function makeWebDeviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  let browser = 'Browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}

/** Current session pinned first, then freshest-first. */
export function sortSessionsForDisplay(sessions: UserSession[], currentSessionId: string | null): UserSession[] {
  return [...sessions].sort((a, b) => {
    if (a.session_id === currentSessionId) return -1;
    if (b.session_id === currentSessionId) return 1;
    return Date.parse(b.last_seen) - Date.parse(a.last_seen);
  });
}

/** Compact relative "last active" text: "now", "5m ago", "3h ago", "2d ago". */
export function relativeLastSeen(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
