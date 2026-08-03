/**
 * Force-logout pulse helpers.
 *
 * profiles.force_logout_at means: revoke sessions that existed BEFORE this time.
 * A fresh sign-in AFTER the pulse must stay signed in (ack the stamp and continue).
 *
 * Previous bug: clients signed out on every login until the user logged in twice
 * (first login acked the stamp and immediately signed out; second kept the session).
 */

export type ForceLogoutDecision = 'keep' | 'revoke' | 'ack_keep';

/**
 * @param forceLogoutAt ISO timestamp from profiles.force_logout_at
 * @param sessionIssuedAtMs when this session was issued (JWT iat or last_sign_in_at)
 * @param ack previously stored ack equal to forceLogoutAt
 */
export function decideForceLogout(
  forceLogoutAt: string | null | undefined,
  sessionIssuedAtMs: number | null | undefined,
  ack: string | null | undefined,
): ForceLogoutDecision {
  if (!forceLogoutAt) return 'keep';
  if (ack === forceLogoutAt) return 'keep';

  const forceMs = Date.parse(forceLogoutAt);
  if (!Number.isFinite(forceMs)) return 'keep';

  // Fresh login after (or within 5s of) the force stamp → keep, but store ack.
  // 5s skew covers clock drift + login then AdminGate race.
  if (
    typeof sessionIssuedAtMs === 'number' &&
    Number.isFinite(sessionIssuedAtMs) &&
    sessionIssuedAtMs + 5_000 >= forceMs
  ) {
    return 'ack_keep';
  }

  // Unknown session age: prefer ack_keep so we never bounce a valid new login.
  // Force-logout still works when last_sign_in_at is clearly older than forceMs.
  if (sessionIssuedAtMs == null || !Number.isFinite(sessionIssuedAtMs)) {
    return 'ack_keep';
  }

  return 'revoke';
}

/** Best-effort session issue time (ms epoch). */
export function sessionIssuedAtMs(session: {
  access_token?: string | null;
  user?: { last_sign_in_at?: string | null } | null;
} | null | undefined): number | null {
  if (!session) return null;

  const last = session.user?.last_sign_in_at;
  if (last) {
    const t = Date.parse(last);
    if (Number.isFinite(t)) return t;
  }

  try {
    const token = session.access_token;
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    // atob in RN / browser; Buffer in Node tests
    let json: string;
    if (typeof atob === 'function') {
      json = atob(padded);
    } else if (typeof Buffer !== 'undefined') {
      json = Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    const payload = JSON.parse(json) as { iat?: number };
    if (typeof payload.iat === 'number') return payload.iat * 1000;
  } catch {
    /* ignore */
  }
  return null;
}
