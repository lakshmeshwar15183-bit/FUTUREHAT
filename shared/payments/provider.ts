// FUTUREHAT+ — payment provider abstraction.
//
// The app talks to payments through this interface only, so swapping or adding a
// gateway (Razorpay, Stripe, …) never touches the upgrade UI. The browser-specific
// Razorpay checkout lives in web/src/payments and implements `PaymentProvider`.

import type { PlanId, PaymentProviderId } from '../types.js';
import { PLANS } from '../premium/plans.js';

export interface PaymentResult {
  ok: boolean;
  provider: PaymentProviderId;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  error?: string;
}

export interface CheckoutContext {
  plan: PlanId;
  userId: string;
  email?: string;
  displayName?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** Run the checkout flow and resolve once payment succeeds (or fails). */
  checkout(ctx: CheckoutContext): Promise<PaymentResult>;
}

/** Compute when a freshly-purchased period ends, from an ISO start. */
export function computePeriodEnd(plan: PlanId, fromIso: string): string {
  const start = new Date(fromIso);
  const end = new Date(start);
  end.setDate(end.getDate() + PLANS[plan].periodDays);
  return end.toISOString();
}

/**
 * Manual provider — no gateway. Resolves successfully so the subscription is
 * activated in the database immediately. Used when no payment keys are configured
 * (local/dev, or self-serve activation). Fully functional end-to-end.
 */
export class ManualProvider implements PaymentProvider {
  readonly id: PaymentProviderId = 'manual';
  async checkout(_ctx: CheckoutContext): Promise<PaymentResult> {
    return { ok: true, provider: 'manual', providerSubscriptionId: `manual_${Date.now()}` };
  }
}
