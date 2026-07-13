/**
 * Production payment-path unit suite.
 * Mirrors Edge Function + DB rules in shared/payments/razorpayLogic.ts.
 * Every critical scenario must PASS before go-live.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  PLAN_AMOUNT_PAISE,
  PLAN_PERIOD_DAYS,
  planFromAmountPaise,
  periodDaysForPlan,
  amountInrFromPaise,
  computePeriodEndIso,
  resolvePlanForActivation,
  isSubscriptionActiveAt,
  canTransitionPaymentStatus,
  isFullyRefunded,
  stableWebhookEventId,
  verifySignaturePayload,
  shouldNoOpActivation,
  sanitizeConfigResponse,
} from '../../../../shared/payments/razorpayLogic';
import { PLANS } from '../../../../shared/premium/plans';

describe('P0 · plan / amount binding', () => {
  it('maps monthly and yearly paise correctly', () => {
    expect(planFromAmountPaise(2500)).toBe('monthly');
    expect(planFromAmountPaise(24900)).toBe('yearly');
  });

  it('rejects unknown amounts (spoof protection)', () => {
    expect(planFromAmountPaise(100)).toBeNull();
    expect(planFromAmountPaise(24901)).toBeNull();
    expect(planFromAmountPaise(0)).toBeNull();
  });

  it('client claimed yearly cannot override monthly payment', () => {
    const r = resolvePlanForActivation({
      clientClaimedPlan: 'yearly',
      amountPaise: 2500,
    });
    expect(r.rejected).toBe(false);
    expect(r.plan).toBe('monthly');
  });

  it('rejects notes.plan mismatch vs amount', () => {
    const r = resolvePlanForActivation({
      amountPaise: 2500,
      orderNotesPlan: 'yearly',
    });
    expect(r.rejected).toBe(true);
    expect(r.plan).toBeNull();
  });

  it('shared plans.ts amounts match Edge PLAN_AMOUNT_PAISE', () => {
    expect(PLANS.monthly.amountPaise).toBe(PLAN_AMOUNT_PAISE.monthly);
    expect(PLANS.yearly.amountPaise).toBe(PLAN_AMOUNT_PAISE.yearly);
    expect(PLANS.monthly.periodDays).toBe(PLAN_PERIOD_DAYS.monthly);
    expect(PLANS.yearly.periodDays).toBe(PLAN_PERIOD_DAYS.yearly);
  });
});

describe('P0 · expiry calculation', () => {
  it('monthly = 30 days, yearly = 365 days', () => {
    expect(periodDaysForPlan('monthly')).toBe(30);
    expect(periodDaysForPlan('yearly')).toBe(365);
  });

  it('amount_inr is rupees from paise', () => {
    expect(amountInrFromPaise(2500)).toBe(25);
    expect(amountInrFromPaise(24900)).toBe(249);
  });

  it('period end is start + periodDays (UTC date math)', () => {
    const start = '2026-01-01T00:00:00.000Z';
    const monthlyEnd = computePeriodEndIso('monthly', start);
    const yearlyEnd = computePeriodEndIso('yearly', start);
    expect(monthlyEnd).toBe('2026-01-31T00:00:00.000Z');
    expect(yearlyEnd).toBe('2027-01-01T00:00:00.000Z');
  });

  it('isSubscriptionActive requires active + future period_end', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(isSubscriptionActiveAt('active', '2026-07-01T00:00:00.000Z', now)).toBe(true);
    expect(isSubscriptionActiveAt('active', '2026-05-01T00:00:00.000Z', now)).toBe(false);
    expect(isSubscriptionActiveAt('cancelled', '2026-07-01T00:00:00.000Z', now)).toBe(false);
    expect(isSubscriptionActiveAt('active', null, now)).toBe(false);
  });
});

describe('P0 · duplicate payment / activation idempotency', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  it('same payment id + same user + active → no-op', () => {
    const r = shouldNoOpActivation({
      existingUserId: 'u1',
      claimUserId: 'u1',
      existingPaymentId: 'pay_abc',
      claimPaymentId: 'pay_abc',
      status: 'active',
      periodEndIso: '2026-07-01T00:00:00.000Z',
      nowMs: now,
    });
    expect(r.noOp).toBe(true);
    expect(r.forbidden).toBe(false);
  });

  it('same payment id bound to another user → forbidden', () => {
    const r = shouldNoOpActivation({
      existingUserId: 'u1',
      claimUserId: 'u2',
      existingPaymentId: 'pay_abc',
      claimPaymentId: 'pay_abc',
      status: 'active',
      periodEndIso: '2026-07-01T00:00:00.000Z',
      nowMs: now,
    });
    expect(r.forbidden).toBe(true);
  });

  it('new payment id allows renew (not no-op)', () => {
    const r = shouldNoOpActivation({
      existingUserId: 'u1',
      claimUserId: 'u1',
      existingPaymentId: 'pay_old',
      claimPaymentId: 'pay_new',
      status: 'active',
      periodEndIso: '2026-07-01T00:00:00.000Z',
      nowMs: now,
    });
    expect(r.noOp).toBe(false);
    expect(r.forbidden).toBe(false);
  });
});

describe('P0 · webhook event id stability (duplicate protection)', () => {
  it('prefers x-razorpay-event-id header', () => {
    expect(
      stableWebhookEventId({
        headerEventId: 'evt_1',
        payloadId: 'other',
        eventType: 'payment.captured',
        paymentId: 'pay_1',
      }),
    ).toBe('evt_1');
  });

  it('falls back to payload.id', () => {
    expect(
      stableWebhookEventId({
        eventType: 'payment.captured',
        payloadId: 'evt_payload',
        paymentId: 'pay_1',
      }),
    ).toBe('evt_payload');
  });

  it('stable composite without Date.now', () => {
    const a = stableWebhookEventId({
      eventType: 'payment.captured',
      paymentId: 'pay_1',
      orderId: 'order_1',
    });
    const b = stableWebhookEventId({
      eventType: 'payment.captured',
      paymentId: 'pay_1',
      orderId: 'order_1',
    });
    expect(a).toBe(b);
    expect(a).toBe('payment.captured:pay_1:order_1');
    expect(a).not.toMatch(/\d{13}/); // no ms timestamp
  });
});

describe('P0 · payment status transitions', () => {
  it('does not regress captured → failed/cancelled', () => {
    expect(canTransitionPaymentStatus('captured', 'failed')).toBe(false);
    expect(canTransitionPaymentStatus('captured', 'cancelled')).toBe(false);
    expect(canTransitionPaymentStatus('captured', 'refunded')).toBe(true);
  });

  it('allows created → captured / failed / cancelled', () => {
    expect(canTransitionPaymentStatus('created', 'captured')).toBe(true);
    expect(canTransitionPaymentStatus('created', 'failed')).toBe(true);
    expect(canTransitionPaymentStatus('created', 'cancelled')).toBe(true);
  });

  it('does not regress refunded → cancelled', () => {
    expect(canTransitionPaymentStatus('refunded', 'cancelled')).toBe(false);
  });
});

describe('P0 · refund handling', () => {
  it('full refund when amount_refunded >= amount', () => {
    expect(isFullyRefunded(2500, 2500)).toBe(true);
    expect(isFullyRefunded(2500, 2499)).toBe(false);
    expect(isFullyRefunded(0, 0)).toBe(false);
  });
});

describe('P0 · signature payload format', () => {
  it('uses order_id|payment_id', () => {
    expect(verifySignaturePayload('order_x', 'pay_y')).toBe('order_x|pay_y');
  });
});

describe('P0 · secrets never in client config', () => {
  it('sanitizeConfigResponse drops secret', () => {
    const out = sanitizeConfigResponse({
      configured: true,
      keyId: 'rzp_test_abc',
      keySecret: 'super_secret',
    });
    expect(out).toEqual({ configured: true, keyId: 'rzp_test_abc' });
    expect(JSON.stringify(out)).not.toMatch(/super_secret/);
  });

  it('returns null keyId when not configured', () => {
    expect(
      sanitizeConfigResponse({ configured: false, keyId: 'rzp_test_abc' }).keyId,
    ).toBeNull();
  });
});

describe('P0 · source contracts (edge + clients)', () => {
  const edge = path.join(
    __dirname,
    '../../../../supabase/functions/payments-razorpay/index.ts',
  );
  const edgeSrc = fs.readFileSync(edge, 'utf8');

  it('edge never returns KEY_SECRET in json bodies', () => {
    expect(edgeSrc).not.toMatch(/json\([^)]*KEY_SECRET/);
    expect(edgeSrc).toMatch(/keyId:\s*configured \? KEY_ID : null/);
  });

  it('edge derives plan from amount (2500 / 24900)', () => {
    expect(edgeSrc).toMatch(/2500/);
    expect(edgeSrc).toMatch(/24900/);
    expect(edgeSrc).toMatch(/planFromAmountPaise/);
  });

  it('edge has webhook signature check', () => {
    expect(edgeSrc).toMatch(/x-razorpay-signature/);
    expect(edgeSrc).toMatch(/hmacSha256Hex/);
    expect(edgeSrc).toMatch(/timingSafeEqualHex/);
  });

  it('edge has create_order, verify, status, mark_cancelled, webhook paths', () => {
    expect(edgeSrc).toMatch(/create_order/);
    expect(edgeSrc).toMatch(/mark_cancelled/);
    expect(edgeSrc).toMatch(/admin_activate_subscription/);
    expect(edgeSrc).toMatch(/admin_revoke_premium_for_payment/);
    expect(edgeSrc).toMatch(/admin_claim_razorpay_webhook/);
  });

  it('edge webhook event id is stable (no Date.now in eventId)', () => {
    // receipt uniqueness may use Date.now; eventId expression must not.
    expect(edgeSrc).toMatch(/Stable id — never Date\.now/);
    expect(edgeSrc).toMatch(/\$\{eventType\}:\$\{paymentId/);
    const assign = edgeSrc.match(/const eventId\s*=\s*([\s\S]*?);/);
    expect(assign?.[1] || '').not.toMatch(/Date\.now\s*\(/);
  });

  it('edge handles order.paid via order payments list', () => {
    expect(edgeSrc).toMatch(/order\.paid/);
    expect(edgeSrc).toMatch(/\/orders\/\$\{.*\}\/payments/);
  });

  it('edge config.toml disables gateway JWT so webhooks work', () => {
    const cfg = path.join(
      __dirname,
      '../../../../supabase/functions/payments-razorpay/config.toml',
    );
    const c = fs.readFileSync(cfg, 'utf8');
    expect(c).toMatch(/verify_jwt\s*=\s*false/);
  });

  it('mobile PremiumScreen uses server verify only', () => {
    const p = path.join(__dirname, '../../screens/PremiumScreen.tsx');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/verifyRazorpayPayment/);
    expect(src).toMatch(/createRazorpayOrder/);
    expect(src).toMatch(/markRazorpayOrderCancelled/);
    expect(src).not.toMatch(/activateSubscription\s*\(/);
    expect(src).toMatch(/ActivityIndicator|creating_order|verifying/);
  });

  it('web razorpay uses verify + cancel mark + status recovery', () => {
    const p = path.join(__dirname, '../../../../web/src/payments/razorpay.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/verifyRazorpayPayment/);
    expect(src).toMatch(/getRazorpayOrderStatus/);
    expect(src).toMatch(/markRazorpayOrderCancelled/);
  });

  it('migrations define payment ledger required columns', () => {
    const m54 = fs.readFileSync(
      path.join(__dirname, '../../../../supabase/migrations/0054_razorpay_payments.sql'),
      'utf8',
    );
    for (const col of [
      'user_id',
      'razorpay_payment_id',
      'razorpay_order_id',
      'amount',
      'currency',
      'status',
      'created_at',
    ]) {
      expect(m54).toMatch(new RegExp(col));
    }
    expect(m54).toMatch(/uq_razorpay_payments_payment/);
    expect(m54).toMatch(/admin_claim_razorpay_webhook/);
  });

  it('migration 0055 re-claims failed webhooks', () => {
    const m55 = fs.readFileSync(
      path.join(__dirname, '../../../../supabase/migrations/0055_razorpay_payment_hardening.sql'),
      'utf8',
    );
    expect(m55).toMatch(/process_error/);
    expect(m55).toMatch(/2 minutes/);
  });
});

describe('P1 · failed / cancelled / loading UX contracts', () => {
  it('PremiumScreen surfaces failed, cancelled, network, seamless activation', () => {
    const p = path.join(__dirname, '../../screens/PremiumScreen.tsx');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/Payment cancelled/);
    expect(src).toMatch(/Payment failed/);
    expect(src).toMatch(/No internet connection/);
    expect(src).toMatch(/Activating Premium/);
    expect(src).toMatch(/beginActivation/);
    expect(src).toMatch(/verifyInBackground/);
    expect(src).toMatch(/Check payment status/);
  });

  it('UpgradeModal has loading spinner and error surface', () => {
    const p = path.join(__dirname, '../../../../web/src/premium/UpgradeModal.tsx');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/fh-spinner/);
    expect(src).toMatch(/upgrade-error|setError/);
    expect(src).toMatch(/navigator\.onLine/);
    expect(src).toMatch(/refreshPaymentsReady/);
  });
});
