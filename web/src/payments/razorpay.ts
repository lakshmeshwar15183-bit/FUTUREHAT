// FUTUREHAT+ — Razorpay checkout (web). Implements the shared PaymentProvider.
// Activates only when VITE_RAZORPAY_KEY_ID is set; otherwise the app falls back
// to the ManualProvider so the upgrade flow stays fully functional in dev.
//
// Production note: for signed verification, create an Order on a server/edge
// function and pass its id here. Without it, this opens checkout in capture mode.

import type { PaymentProvider, PaymentResult, CheckoutContext } from '@shared/payments/provider';
import { PLANS } from '@shared/premium/plans';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export class RazorpayWebProvider implements PaymentProvider {
  readonly id = 'razorpay' as const;
  constructor(private keyId: string) {}

  async checkout(ctx: CheckoutContext): Promise<PaymentResult> {
    const ok = await loadScript();
    if (!ok || !window.Razorpay) {
      return { ok: false, provider: 'razorpay', error: 'Could not load Razorpay' };
    }
    const plan = PLANS[ctx.plan];

    return new Promise<PaymentResult>((resolve) => {
      const rzp = new window.Razorpay({
        key: this.keyId,
        amount: plan.amountPaise,
        currency: 'INR',
        name: 'FUTUREHAT+',
        description: `${plan.label} subscription`,
        prefill: { name: ctx.displayName, email: ctx.email },
        theme: { color: '#00a884' },
        handler: (resp: any) => {
          resolve({
            ok: true,
            provider: 'razorpay',
            providerSubscriptionId: resp.razorpay_payment_id,
          });
        },
        modal: {
          ondismiss: () => resolve({ ok: false, provider: 'razorpay', error: 'Payment cancelled' }),
        },
      });
      // A reported payment failure must settle the promise too — otherwise the
      // upgrade button stays stuck on the spinner when the user doesn't dismiss.
      rzp.on('payment.failed', (resp: any) => {
        resolve({
          ok: false,
          provider: 'razorpay',
          error: resp?.error?.description || 'Payment failed',
        });
      });
      rzp.open();
    });
  }
}
