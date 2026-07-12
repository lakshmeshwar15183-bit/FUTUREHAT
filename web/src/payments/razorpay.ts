// Lumixo+ — Razorpay checkout (web).
//
// CRITICAL production path:
//   1) Edge Function creates a Razorpay Order (server-side amount).
//   2) Checkout opens with that order_id.
//   3) On success, Edge Function verifies HMAC signature + activates subscription
//      via service-role admin_activate_subscription.
// Client never writes to `subscriptions` directly.
import { supabase } from '../supabase';
import type { PaymentProvider, PaymentResult, CheckoutContext } from '@shared/payments/provider';

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

    // Server-created order (amount cannot be spoofed by the client).
    const { data: orderData, error: orderErr } = await supabase.functions.invoke('payments-razorpay', {
      body: { action: 'create_order', plan: ctx.plan },
    });
    if (orderErr || !orderData?.orderId) {
      return {
        ok: false,
        provider: 'razorpay',
        error: orderErr?.message || orderData?.error || 'Could not start secure checkout',
      };
    }

    const keyId = orderData.keyId || this.keyId;
    const orderId = orderData.orderId as string;

    return new Promise<PaymentResult>((resolve) => {
      let settled = false;
      const settle = (r: PaymentResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      const rzp = new window.Razorpay({
        key: keyId,
        order_id: orderId,
        name: 'Lumixo+',
        description: `${ctx.plan === 'yearly' ? 'Yearly' : 'Monthly'} subscription`,
        prefill: { name: ctx.displayName, email: ctx.email },
        theme: { color: '#00a884' },
        handler: async (resp: any) => {
          try {
            const { data, error } = await supabase.functions.invoke('payments-razorpay', {
              body: {
                action: 'verify',
                plan: ctx.plan,
                razorpay_order_id: resp.razorpay_order_id || orderId,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            });
            if (error || !data?.ok) {
              settle({
                ok: false,
                provider: 'razorpay',
                error: error?.message || data?.error || 'Payment verification failed',
              });
              return;
            }
            settle({
              ok: true,
              provider: 'razorpay',
              providerSubscriptionId: resp.razorpay_payment_id,
            });
          } catch (e: any) {
            settle({
              ok: false,
              provider: 'razorpay',
              error: e?.message || 'Payment verification failed',
            });
          }
        },
        modal: {
          ondismiss: () => settle({ ok: false, provider: 'razorpay', error: 'Payment cancelled' }),
        },
      });
      rzp.on('payment.failed', (resp: any) => {
        settle({
          ok: false,
          provider: 'razorpay',
          error: resp?.error?.description || 'Payment failed',
        });
      });
      rzp.open();
    });
  }
}
