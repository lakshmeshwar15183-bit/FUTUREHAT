// Lumixo — unit tests for pure local-first helpers.
import {
  mergeMessagesById,
  mergeNetworkMessages,
  latestSyncedCreatedAt,
  oldestCreatedAt,
  retryDelayMs,
  MSG_CACHE_LIMIT,
} from '../localFirst';
import type { Message } from '../types';

function msg(partial: Partial<Message> & { id: string; created_at: string }): Message {
  return {
    conversation_id: 'c1',
    sender_id: 'u1',
    type: 'text',
    content: '',
    media_url: null,
    reply_to: null,
    is_deleted: false,
    edited_at: null,
    ...partial,
  } as Message;
}

describe('localFirst', () => {
  test('mergeMessagesById prefers primary and sorts chrono', () => {
    const a = msg({ id: '1', created_at: '2026-01-02T00:00:00Z', content: 'a' });
    const b = msg({ id: '2', created_at: '2026-01-01T00:00:00Z', content: 'b' });
    const a2 = msg({ id: '1', created_at: '2026-01-02T00:00:00Z', content: 'a-updated' });
    const merged = mergeMessagesById([a], [b, a2]);
    expect(merged.map((m) => m.id)).toEqual(['2', '1']);
    expect(merged[1].content).toBe('a'); // primary wins
  });

  test('mergeNetworkMessages keeps pending local-only rows', () => {
    const net = [msg({ id: '1', created_at: '2026-01-01T00:00:00Z' })];
    const local = [
      msg({ id: '1', created_at: '2026-01-01T00:00:00Z', content: 'stale' }),
      { ...msg({ id: 'temp', created_at: '2026-01-02T00:00:00Z' }), pending: true } as Message,
    ];
    const merged = mergeNetworkMessages(local, net, 'replaceRecent');
    expect(merged.map((m) => m.id).sort()).toEqual(['1', 'temp']);
    expect(merged.find((m) => m.id === '1')?.content).toBe(''); // network wins
  });

  test('delta mode upserts without dropping history', () => {
    const local = [
      msg({ id: '1', created_at: '2026-01-01T00:00:00Z' }),
      msg({ id: '2', created_at: '2026-01-02T00:00:00Z' }),
    ];
    const delta = [msg({ id: '3', created_at: '2026-01-03T00:00:00Z' })];
    const merged = mergeNetworkMessages(local, delta, 'delta');
    expect(merged.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  test('watermarks skip pending', () => {
    const list = [
      msg({ id: '1', created_at: '2026-01-01T00:00:00Z' }),
      { ...msg({ id: 'p', created_at: '2026-01-09T00:00:00Z' }), pending: true } as Message,
      msg({ id: '2', created_at: '2026-01-05T00:00:00Z' }),
    ];
    expect(latestSyncedCreatedAt(list)).toBe('2026-01-05T00:00:00Z');
    expect(oldestCreatedAt(list)).toBe('2026-01-01T00:00:00Z');
  });

  test('retryDelayMs grows and caps', () => {
    const d0 = retryDelayMs(0, 1000, 10_000);
    const d5 = retryDelayMs(5, 1000, 10_000);
    expect(d0).toBeGreaterThanOrEqual(800);
    expect(d0).toBeLessThanOrEqual(1200);
    expect(d5).toBeLessThanOrEqual(10_000 * 1.2);
    expect(MSG_CACHE_LIMIT).toBe(800);
  });
});
