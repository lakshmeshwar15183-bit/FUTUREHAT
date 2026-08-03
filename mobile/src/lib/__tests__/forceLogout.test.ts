import { decideForceLogout, sessionIssuedAtMs } from '../../../../shared/forceLogout';

describe('decideForceLogout', () => {
  const forceAt = '2026-07-13T10:00:00.000Z';
  const forceMs = Date.parse(forceAt);

  it('keeps when already acked', () => {
    expect(decideForceLogout(forceAt, forceMs - 60_000, forceAt)).toBe('keep');
  });

  it('acks and keeps a login after force-logout (fixes double-login)', () => {
    // User re-authenticated 1s after force stamp
    expect(decideForceLogout(forceAt, forceMs + 1000, null)).toBe('ack_keep');
    expect(decideForceLogout(forceAt, forceMs + 60_000, 'old-ack')).toBe('ack_keep');
  });

  it('revokes a session that is clearly older than force-logout', () => {
    expect(decideForceLogout(forceAt, forceMs - 60_000, null)).toBe('revoke');
    expect(decideForceLogout(forceAt, forceMs - 5 * 60_000, 'other')).toBe('revoke');
  });

  it('acks and keeps when session age unknown (never bounce valid login)', () => {
    expect(decideForceLogout(forceAt, null, null)).toBe('ack_keep');
  });

  it('no force stamp → keep', () => {
    expect(decideForceLogout(null, forceMs, null)).toBe('keep');
    expect(decideForceLogout(undefined, forceMs, null)).toBe('keep');
  });
});

describe('sessionIssuedAtMs', () => {
  it('reads last_sign_in_at', () => {
    const t = sessionIssuedAtMs({
      user: { last_sign_in_at: '2026-07-13T12:00:00.000Z' },
    });
    expect(t).toBe(Date.parse('2026-07-13T12:00:00.000Z'));
  });

  it('reads JWT iat', () => {
    // header.payload.sig — payload = {"iat":1700000000}
    const payload = Buffer.from(JSON.stringify({ iat: 1700000000 })).toString('base64url');
    const token = `eyJhbGciOiJub25lIn0.${payload}.x`;
    const t = sessionIssuedAtMs({ access_token: token });
    expect(t).toBe(1700000000 * 1000);
  });
});
