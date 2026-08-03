// Lumixo — single source of truth for outbound message tick status (✓ / ✓✓).
//
// Chat list and chat thread MUST derive ticks from these pure helpers so they
// can never disagree. Status is monotonic: sending → sent → delivered → read
// (failed is a terminal local state that can recover to sent on retry).

export type TickStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ReceiptLike = {
  message_id: string;
  user_id: string;
  status: string;
};

const RANK: Record<TickStatus, number> = {
  failed: -1,
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function tickRank(t: TickStatus): number {
  return RANK[t] ?? 0;
}

/** Higher rank wins. Equal ranks keep `a`. */
export function maxTick(a: TickStatus, b: TickStatus): TickStatus {
  return tickRank(a) >= tickRank(b) ? a : b;
}

/**
 * Monotonic merge for a single message's display tick.
 * - Never downgrades delivered/read to sent.
 * - `failed` replaces anything (local outbox death).
 * - A non-failed status recovers from `failed` (retry succeeded).
 */
export function mergeTick(
  current: TickStatus | undefined | null,
  incoming: TickStatus,
): TickStatus {
  if (current == null) return incoming;
  if (incoming === 'failed') return 'failed';
  if (current === 'failed') return incoming;
  return maxTick(current, incoming);
}

export function receiptStatusToTick(status: string): TickStatus | null {
  if (status === 'read' || status === 'delivered') return status;
  return null;
}

/**
 * Aggregate recipient receipts into one outbound tick for the sender.
 * Ignores the sender's own receipt rows (if any). No recipient receipts → `sent`
 * (server accepted the message; device delivery not yet confirmed).
 *
 * WhatsApp-class rule used here: best status across recipients
 * (any delivered → delivered, any read → read). Groups use the same rule so
 * list + thread stay identical.
 */
export function aggregateRecipientTick(
  receipts: readonly ReceiptLike[],
  messageId: string,
  senderId?: string | null,
): TickStatus {
  let best: TickStatus = 'sent';
  for (const r of receipts) {
    if (r.message_id !== messageId) continue;
    if (senderId && r.user_id === senderId) continue;
    const t = receiptStatusToTick(r.status);
    if (t) best = maxTick(best, t);
  }
  return best;
}

/** Build messageId → TickStatus for a batch of receipts (sender's view). */
export function buildTickMap(
  receipts: readonly ReceiptLike[],
  senderId?: string | null,
  messageIds?: readonly string[],
): Map<string, TickStatus> {
  const ids =
    messageIds ??
    [...new Set(receipts.map((r) => r.message_id))];
  const map = new Map<string, TickStatus>();
  for (const id of ids) {
    map.set(id, aggregateRecipientTick(receipts, id, senderId));
  }
  return map;
}

/**
 * Apply one receipt row into an existing tick map (realtime / partial refresh).
 * Monotonic — cannot downgrade a higher status already shown.
 */
export function applyReceiptToTickMap(
  map: Map<string, TickStatus>,
  receipt: ReceiptLike,
  senderId?: string | null,
): Map<string, TickStatus> {
  if (senderId && receipt.user_id === senderId) return map;
  const t = receiptStatusToTick(receipt.status);
  if (!t) return map;
  const next = new Map(map);
  next.set(receipt.message_id, mergeTick(next.get(receipt.message_id), t));
  return next;
}

/**
 * Final outbound tick for UI (bubble or list preview).
 * Local pending/failed always win over server receipts.
 */
export function computeOutboundTick(opts: {
  pending?: boolean | null;
  failed?: boolean | null;
  messageId: string;
  senderId?: string | null;
  receipts?: readonly ReceiptLike[];
  /** Precomputed map (preferred when rendering many bubbles). */
  tickMap?: Map<string, TickStatus> | null;
}): TickStatus {
  if (opts.failed) return 'failed';
  if (opts.pending) return 'sending';
  if (opts.tickMap?.has(opts.messageId)) {
    return opts.tickMap.get(opts.messageId)!;
  }
  if (opts.receipts) {
    return aggregateRecipientTick(opts.receipts, opts.messageId, opts.senderId);
  }
  return 'sent';
}

/** Glyph / icon helpers — keep list + bubble presentation in lockstep. */
export function tickIsDouble(t: TickStatus): boolean {
  return t === 'delivered' || t === 'read';
}

export function tickIsRead(t: TickStatus): boolean {
  return t === 'read';
}

export function tickLabel(t: TickStatus): string {
  switch (t) {
    case 'sending': return 'Sending…';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'read': return 'Read';
    case 'failed': return 'Failed';
    default: return 'Sent';
  }
}

/** Web / text glyph for preview + bubble. */
export function tickGlyph(t: TickStatus): string {
  if (t === 'sending') return '🕓';
  if (t === 'failed') return '!';
  if (tickIsDouble(t)) return '✓✓';
  return '✓';
}
