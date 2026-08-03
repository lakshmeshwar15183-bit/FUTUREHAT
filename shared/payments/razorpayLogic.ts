// Pure payment-path logic shared by unit tests (mirrors Edge Function rules).
// Keep in lockstep with supabase/functions/payments-razorpay/index.ts and plans.ts.

export const PLAN_AMOUNT_PAISE = {
  monthly: 2500,
  yearly: 24900,
} as const;

export const PLAN_PERIOD_DAYS = {
  monthly: 30,
  yearly: 365,
} as const;

export type PlanId = 'monthly' | 'yearly';

export function planFromAmountPaise(amountPaise: number): PlanId | null {
  if (amountPaise === PLAN_AMOUNT_PAISE.yearly) return 'yearly';
  if (amountPaise === PLAN_AMOUNT_PAISE.monthly) return 'monthly';
  return null;
}

export function periodDaysForPlan(plan: PlanId): number {
  return PLAN_PERIOD_DAYS[plan];
}

/** amount_inr stored on subscriptions is rupees (Edge Function Math.round(paise/100)). */
export function amountInrFromPaise(amountPaise: number): number {
  return Math.round(amountPaise / 100);
}

export function computePeriodEndIso(plan: PlanId, fromIso: string): string {
  const start = new Date(fromIso);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + periodDaysForPlan(plan));
  return end.toISOString();
}

/** Client body.plan must never override amount-derived plan. */
export function resolvePlanForActivation(args: {
  clientClaimedPlan?: string | null;
  amountPaise: number;
  orderNotesPlan?: string | null;
}): { plan: PlanId | null; rejected: boolean; reason?: string } {
  const fromAmount = planFromAmountPaise(args.amountPaise);
  if (!fromAmount) {
    return { plan: null, rejected: true, reason: 'amount_not_a_plan' };
  }
  if (args.orderNotesPlan && args.orderNotesPlan !== fromAmount) {
    return { plan: null, rejected: true, reason: 'notes_plan_mismatch' };
  }
  // Client claim is ignored for activation; amount wins.
  void args.clientClaimedPlan;
  return { plan: fromAmount, rejected: false };
}

export function isSubscriptionActiveAt(
  status: string | null | undefined,
  currentPeriodEndIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (status !== 'active') return false;
  if (!currentPeriodEndIso) return false;
  return new Date(currentPeriodEndIso).getTime() > nowMs;
}

/** Payment ledger status transitions that must not regress a capture. */
export function canTransitionPaymentStatus(
  existing: string,
  next: string,
): boolean {
  if (existing === next) return true;
  if (existing === 'captured' && ['failed', 'cancelled', 'attempted', 'created'].includes(next)) {
    return false;
  }
  if (existing === 'refunded' && ['failed', 'cancelled', 'attempted', 'created'].includes(next)) {
    return false;
  }
  return true;
}

/** Fully refunded when amount_refunded covers original amount. */
export function isFullyRefunded(amountPaise: number, amountRefunded: number): boolean {
  return amountPaise > 0 && amountRefunded >= amountPaise;
}

/**
 * Stable webhook event id when Razorpay omits x-razorpay-event-id.
 * Must NOT use Date.now() (breaks idempotency on retries).
 */
export function stableWebhookEventId(args: {
  headerEventId?: string | null;
  payloadId?: string | null;
  eventType: string;
  paymentId?: string | null;
  orderId?: string | null;
  refundId?: string | null;
}): string {
  if (args.headerEventId && args.headerEventId.trim()) return args.headerEventId.trim();
  if (args.payloadId && String(args.payloadId).trim()) return String(args.payloadId).trim();
  const pay = args.paymentId || args.refundId || 'nopay';
  const ord = args.orderId || 'noord';
  return `${args.eventType}:${pay}:${ord}`;
}

/** HMAC payload for payment verification (Razorpay order checkout). */
export function verifySignaturePayload(orderId: string, paymentId: string): string {
  return `${orderId}|${paymentId}`;
}

/**
 * Whether a second activation for the same provider payment id should no-op.
 * Mirrors admin_activate_subscription idempotency guard.
 */
export function shouldNoOpActivation(args: {
  existingUserId: string;
  claimUserId: string;
  existingPaymentId: string | null;
  claimPaymentId: string;
  status: string;
  periodEndIso: string;
  nowMs: number;
}): { noOp: boolean; forbidden: boolean } {
  if (
    args.existingPaymentId === args.claimPaymentId &&
    args.existingUserId !== args.claimUserId
  ) {
    return { noOp: false, forbidden: true };
  }
  if (
    args.existingUserId === args.claimUserId &&
    args.existingPaymentId === args.claimPaymentId &&
    args.status === 'active' &&
    new Date(args.periodEndIso).getTime() > args.nowMs
  ) {
    return { noOp: true, forbidden: false };
  }
  return { noOp: false, forbidden: false };
}

/** Secrets must never appear in client-facing config payloads. */
export function sanitizeConfigResponse(args: {
  configured: boolean;
  keyId: string | null;
  keySecret?: string;
}): { configured: boolean; keyId: string | null } {
  void args.keySecret;
  return {
    configured: args.configured,
    keyId: args.configured ? args.keyId : null,
  };
}
