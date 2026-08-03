/**
 * Device session management — pure decision/format helpers (0067 migration).
 * WhatsApp-style: 2-phone limit, individual remote sign-out, web unlimited.
 */
import {
  makeWebDeviceLabel,
  revokedSignOutMessage,
  sortSessionsForDisplay,
  relativeLastSeen,
  type UserSession,
} from '../../../../shared/sessionsApi';

function sess(over: Partial<UserSession>): UserSession {
  return {
    session_id: 'sid-default',
    user_id: 'uid',
    platform: 'android',
    device_label: null,
    created_at: '2026-08-01T00:00:00Z',
    last_seen: '2026-08-01T00:00:00Z',
    revoked_at: null,
    revoked_reason: null,
    ...over,
  };
}

describe('revokedSignOutMessage', () => {
  it('explains the 2-phone limit for phone_limit', () => {
    const msg = revokedSignOutMessage('phone_limit');
    expect(msg).toMatch(/another phone/i);
    expect(msg).toMatch(/2 phones/i);
  });
  it('explains remote sign-out', () => {
    expect(revokedSignOutMessage('remote')).toMatch(/another device/i);
  });
  it('explains logout-all', () => {
    expect(revokedSignOutMessage('logout_all')).toMatch(/all devices/i);
  });
  it('falls back gracefully for unknown reasons', () => {
    expect(revokedSignOutMessage(null)).toMatch(/signed out/i);
    expect(revokedSignOutMessage(undefined)).toMatch(/signed out/i);
  });
});

describe('makeWebDeviceLabel', () => {
  const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
  const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  it('detects Chrome on Windows', () => expect(makeWebDeviceLabel(CHROME_WIN)).toBe('Chrome · Windows'));
  it('detects Edge (not Chrome) on Windows', () => expect(makeWebDeviceLabel(EDGE_WIN)).toBe('Edge · Windows'));
  it('detects Safari on macOS', () => expect(makeWebDeviceLabel(SAFARI_MAC)).toBe('Safari · macOS'));
  it('detects Firefox on Linux', () => expect(makeWebDeviceLabel(FIREFOX_LINUX)).toBe('Firefox · Linux'));
  it('detects Chrome on Android', () => expect(makeWebDeviceLabel(CHROME_ANDROID)).toBe('Chrome · Android'));
  it('detects Safari on iPhone', () => expect(makeWebDeviceLabel(SAFARI_IPHONE)).toBe('Safari · iOS'));
  it('never throws on garbage', () => {
    expect(makeWebDeviceLabel('')).toBe('Browser · Unknown OS');
    expect(makeWebDeviceLabel(null)).toBe('Browser · Unknown OS');
    expect(makeWebDeviceLabel(undefined)).toBe('Browser · Unknown OS');
  });
});

describe('sortSessionsForDisplay', () => {
  it('pins the current session first, rest freshest-first', () => {
    const a = sess({ session_id: 'a', last_seen: '2026-08-03T10:00:00Z' });
    const b = sess({ session_id: 'b', last_seen: '2026-08-03T12:00:00Z' });
    const me = sess({ session_id: 'me', last_seen: '2026-08-01T00:00:00Z' });
    const out = sortSessionsForDisplay([a, b, me], 'me');
    expect(out.map((s) => s.session_id)).toEqual(['me', 'b', 'a']);
  });
  it('handles missing current session id', () => {
    const a = sess({ session_id: 'a', last_seen: '2026-08-03T10:00:00Z' });
    const b = sess({ session_id: 'b', last_seen: '2026-08-03T12:00:00Z' });
    const out = sortSessionsForDisplay([a, b], null);
    expect(out.map((s) => s.session_id)).toEqual(['b', 'a']);
  });
  it('does not mutate the input array', () => {
    const list = [sess({ session_id: 'a' }), sess({ session_id: 'b' })];
    const copy = [...list];
    sortSessionsForDisplay(list, 'b');
    expect(list).toEqual(copy);
  });
});

describe('relativeLastSeen', () => {
  const now = Date.parse('2026-08-03T12:00:00Z');
  it('says "now" under a minute', () => {
    expect(relativeLastSeen('2026-08-03T11:59:30Z', now)).toBe('now');
  });
  it('formats minutes', () => {
    expect(relativeLastSeen('2026-08-03T11:15:00Z', now)).toBe('45m ago');
  });
  it('formats hours', () => {
    expect(relativeLastSeen('2026-08-03T07:00:00Z', now)).toBe('5h ago');
  });
  it('formats days', () => {
    expect(relativeLastSeen('2026-08-01T12:00:00Z', now)).toBe('2d ago');
  });
  it('clamps future timestamps to "now" (clock skew)', () => {
    expect(relativeLastSeen('2026-08-03T12:05:00Z', now)).toBe('now');
  });
  it('never throws on garbage', () => {
    expect(relativeLastSeen(null, now)).toBe('');
    expect(relativeLastSeen('not-a-date', now)).toBe('');
  });
});
