import {
  pruneExpiredGroups,
  statusExpired,
  type StatusGroup,
} from '../statusData';
function makeStatus(id: string, expiresInMs: number) {
  const now = Date.now();
  return {
    id,
    user_id: 'u1',
    type: 'text' as const,
    content: 'hi',
    media_url: null,
    background: null,
    caption: null,
    text_color: null,
    duration_ms: null,
    audience: 'everyone' as const,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + expiresInMs).toISOString(),
  } as any;
}

describe('statusData', () => {
  test('statusExpired respects expires_at', () => {
    const s = makeStatus('a', 10_000);
    expect(statusExpired(s, Date.now() - 1000)).toBe(false);
    expect(statusExpired(s, Date.now() + 20_000)).toBe(true);
  });

  test('pruneExpiredGroups drops empty groups and keeps live ones', () => {
    const live = makeStatus('live', 60_000);
    const dead = makeStatus('dead', -1000);
    const group: StatusGroup = {
      userId: 'u1',
      profile: null,
      statuses: [live, dead],
      allSeen: false,
    };
    const res = pruneExpiredGroups(null, [group], Date.now());
    expect(res.changed).toBe(true);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].statuses.map((s) => s.id)).toEqual(['live']);
  });
});
