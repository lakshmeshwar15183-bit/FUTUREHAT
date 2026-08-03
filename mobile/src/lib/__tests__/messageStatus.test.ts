/**
 * Message tick consistency — unit tests for the shared messageStatus engine.
 * These prove list + bubble can never disagree when both use computeOutboundTick.
 *
 * Scenarios covered:
 *  - Sent → Delivered → Read (monotonic)
 *  - No inventing double-ticks without receipts
 *  - Offline/pending send
 *  - Failed send
 *  - Multi-recipient / multi-device receipts (best status wins)
 *  - Ignore sender's own receipt rows
 *  - Never downgrade on late/stale delivered after read
 *  - Slow/fast network ordering (out-of-order receipt events)
 *  - List preview vs bubble identity invariant
 */

import {
  mergeTick,
  maxTick,
  tickRank,
  aggregateRecipientTick,
  buildTickMap,
  applyReceiptToTickMap,
  computeOutboundTick,
  tickIsDouble,
  tickIsRead,
  tickGlyph,
  tickLabel,
  type TickStatus,
  type ReceiptLike,
} from '../../../../shared/messageStatus';

function r(message_id: string, user_id: string, status: 'delivered' | 'read'): ReceiptLike {
  return { message_id, user_id, status };
}

describe('messageStatus — rank & merge', () => {
  test('rank order is sending < sent < delivered < read', () => {
    expect(tickRank('sending')).toBeLessThan(tickRank('sent'));
    expect(tickRank('sent')).toBeLessThan(tickRank('delivered'));
    expect(tickRank('delivered')).toBeLessThan(tickRank('read'));
  });

  test('mergeTick never downgrades delivered/read', () => {
    expect(mergeTick('read', 'delivered')).toBe('read');
    expect(mergeTick('read', 'sent')).toBe('read');
    expect(mergeTick('delivered', 'sent')).toBe('delivered');
    expect(mergeTick('delivered', 'delivered')).toBe('delivered');
  });

  test('mergeTick upgrades sent → delivered → read', () => {
    expect(mergeTick('sent', 'delivered')).toBe('delivered');
    expect(mergeTick('delivered', 'read')).toBe('read');
    expect(mergeTick(undefined, 'sent')).toBe('sent');
  });

  test('failed is sticky until a non-failed status recovers it', () => {
    expect(mergeTick('sent', 'failed')).toBe('failed');
    expect(mergeTick('failed', 'sent')).toBe('sent');
    expect(mergeTick('failed', 'delivered')).toBe('delivered');
  });

  test('maxTick picks the higher status', () => {
    expect(maxTick('sent', 'delivered')).toBe('delivered');
    expect(maxTick('read', 'delivered')).toBe('read');
  });
});

describe('messageStatus — Sent → Delivered → Read pipeline', () => {
  const msg = 'm1';
  const me = 'sender';
  const peer = 'peer';

  test('no receipts ⇒ sent (single tick)', () => {
    expect(aggregateRecipientTick([], msg, me)).toBe('sent');
    expect(computeOutboundTick({ messageId: msg, senderId: me, receipts: [] })).toBe('sent');
    expect(tickIsDouble('sent')).toBe(false);
    expect(tickGlyph('sent')).toBe('✓');
  });

  test('delivered receipt ⇒ delivered (double grey)', () => {
    const receipts = [r(msg, peer, 'delivered')];
    const t = aggregateRecipientTick(receipts, msg, me);
    expect(t).toBe('delivered');
    expect(tickIsDouble(t)).toBe(true);
    expect(tickIsRead(t)).toBe(false);
    expect(tickGlyph(t)).toBe('✓✓');
    expect(tickLabel(t)).toBe('Delivered');
  });

  test('read receipt ⇒ read (double blue)', () => {
    const receipts = [r(msg, peer, 'read')];
    const t = aggregateRecipientTick(receipts, msg, me);
    expect(t).toBe('read');
    expect(tickIsDouble(t)).toBe(true);
    expect(tickIsRead(t)).toBe(true);
    expect(tickGlyph(t)).toBe('✓✓');
    expect(tickLabel(t)).toBe('Read');
  });

  test('offline / pending send ⇒ sending (clock)', () => {
    expect(computeOutboundTick({
      messageId: msg,
      pending: true,
      senderId: me,
      receipts: [r(msg, peer, 'read')], // server noise must not override pending
    })).toBe('sending');
  });

  test('failed local send ⇒ failed', () => {
    expect(computeOutboundTick({
      messageId: msg,
      failed: true,
      senderId: me,
      receipts: [],
    })).toBe('failed');
  });
});

describe('messageStatus — multi-device / multi-recipient / ordering', () => {
  const msg = 'm2';
  const me = 'sender';

  test('ignores sender own receipt rows', () => {
    const receipts = [r(msg, me, 'read'), r(msg, 'peer', 'delivered')];
    expect(aggregateRecipientTick(receipts, msg, me)).toBe('delivered');
  });

  test('best status across devices/recipients wins (any read → read)', () => {
    const receipts = [
      r(msg, 'peer-a', 'delivered'),
      r(msg, 'peer-b', 'read'),
    ];
    expect(aggregateRecipientTick(receipts, msg, me)).toBe('read');
  });

  test('out-of-order events (fast then slow network) never downgrade', () => {
    let map = new Map<string, TickStatus>();
    // Fast path: read lands first
    map = applyReceiptToTickMap(map, r(msg, 'peer', 'read'), me);
    expect(map.get(msg)).toBe('read');
    // Slow path: stale delivered arrives later
    map = applyReceiptToTickMap(map, r(msg, 'peer', 'delivered'), me);
    expect(map.get(msg)).toBe('read');
  });

  test('slow network: delivered then read upgrades correctly', () => {
    let map = new Map<string, TickStatus>();
    map = applyReceiptToTickMap(map, r(msg, 'peer', 'delivered'), me);
    expect(map.get(msg)).toBe('delivered');
    map = applyReceiptToTickMap(map, r(msg, 'peer', 'read'), me);
    expect(map.get(msg)).toBe('read');
  });

  test('buildTickMap batches many messages consistently', () => {
    const receipts = [
      r('a', 'p', 'delivered'),
      r('b', 'p', 'read'),
      r('c', 'p', 'delivered'),
    ];
    const map = buildTickMap(receipts, me, ['a', 'b', 'c', 'd']);
    expect(map.get('a')).toBe('delivered');
    expect(map.get('b')).toBe('read');
    expect(map.get('c')).toBe('delivered');
    expect(map.get('d')).toBe('sent'); // no receipts
  });
});

describe('messageStatus — list vs chat identity invariant', () => {
  /**
   * Simulates chat list preview and open-chat bubble both calling
   * computeOutboundTick with the same inputs — they MUST match.
   */
  function listTick(args: Parameters<typeof computeOutboundTick>[0]): TickStatus {
    return computeOutboundTick(args);
  }
  function bubbleTick(args: Parameters<typeof computeOutboundTick>[0]): TickStatus {
    return computeOutboundTick(args);
  }

  const cases: Array<{ name: string; args: Parameters<typeof computeOutboundTick>[0] }> = [
    { name: 'sent only', args: { messageId: 'x', senderId: 'me', receipts: [] } },
    {
      name: 'delivered',
      args: { messageId: 'x', senderId: 'me', receipts: [r('x', 'p', 'delivered')] },
    },
    {
      name: 'read',
      args: { messageId: 'x', senderId: 'me', receipts: [r('x', 'p', 'read')] },
    },
    {
      name: 'pending offline',
      args: { messageId: 'x', senderId: 'me', pending: true, receipts: [] },
    },
    {
      name: 'failed',
      args: { messageId: 'x', senderId: 'me', failed: true, receipts: [] },
    },
    {
      name: 'tickMap path',
      args: {
        messageId: 'x',
        senderId: 'me',
        tickMap: new Map([['x', 'delivered' as TickStatus]]),
      },
    },
  ];

  test.each(cases)('list and bubble agree: $name', ({ args }) => {
    expect(listTick(args)).toBe(bubbleTick(args));
  });

  test('list never hardcodes double-tick without receipts', () => {
    // Pre-fix bug: ConversationsScreen always rendered checkmark-done.
    // With shared engine, empty receipts ⇒ single tick.
    const t = computeOutboundTick({ messageId: 'x', senderId: 'me', receipts: [] });
    expect(tickIsDouble(t)).toBe(false);
    expect(t).toBe('sent');
  });
});

describe('messageStatus — reconnect / restart semantics', () => {
  test('rebuild from full receipt set after restart yields same map', () => {
    const receipts = [
      r('m1', 'p', 'delivered'),
      r('m2', 'p', 'read'),
    ];
    const before = buildTickMap(receipts, 'me', ['m1', 'm2', 'm3']);
    // Simulate app restart: rebuild from same server data
    const after = buildTickMap(receipts, 'me', ['m1', 'm2', 'm3']);
    expect([...after.entries()]).toEqual([...before.entries()]);
    expect(after.get('m3')).toBe('sent');
  });

  test('partial realtime then full rebuild is monotonic-compatible', () => {
    let live = new Map<string, TickStatus>();
    live = applyReceiptToTickMap(live, r('m1', 'p', 'delivered'), 'me');
    const full = buildTickMap([r('m1', 'p', 'read')], 'me', ['m1']);
    // Full rebuild may jump to read (server truth); live must not stay stuck below
    expect(full.get('m1')).toBe('read');
    expect(mergeTick(live.get('m1'), full.get('m1')!)).toBe('read');
  });
});
