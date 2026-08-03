// Lumixo+ — Razorpay checkout (web).
//
// CRITICAL production path:
//   1) Edge Function creates a Razorpay Order (server-side amount).
//   2) Checkout opens with that order_id + public key_id from server.
//   3) On success, Edge Function verifies HMAC signature + activates subscription
//      via service-role admin_activate_subscription.
// Client never writes to `subscriptions` directly. KEY_SECRET never ships here.
import { supabase } from '../supabase';
import type { PaymentProvider, PaymentResult, CheckoutContext } from '@shared/payments/provider';
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  getRazorpayOrderStatus,
  markRazorpayOrderCancelled,
  friendlyRazorpayCheckoutFailure,
} from '@shared/payments/razorpayApi';

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

  /** @param keyIdFallback optional public key if create_order omits keyId (should not happen). */
  constructor(private keyIdFallback?: string) {}

  async checkout(ctx: CheckoutContext): Promise<PaymentResult> {
    const ok = await loadScript();
    if (!ok || !window.Razorpay) {
      return { ok: false, provider: 'razorpay', error: 'Could not load Razorpay. Check your network and try again.' };
    }

    const { order, error: orderErr } = await createRazorpayOrder(supabase, ctx.plan);
    if (orderErr || !order) {
      return {
        ok: false,
        provider: 'razorpay',
        error: orderErr?.message || 'Could not start secure checkout',
      };
    }

    const keyId = order.keyId || this.keyIdFallback;
    if (!keyId) {
      return { ok: false, provider: 'razorpay', error: 'Payment configuration incomplete' };
    }
    const orderId = order.orderId;

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
        amount: order.amount,
        currency: order.currency,
        name: 'Lumixo+',
        description: `${ctx.plan === 'yearly' ? 'Yearly' : 'Monthly'} subscription`,
        prefill: { name: ctx.displayName, email: ctx.email },
        theme: { color: '#00a884' },
        handler: async (resp: any) => {
          try {
            const verified = await verifyRazorpayPayment(supabase, {
              razorpay_order_id: resp.razorpay_order_id || orderId,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            if (!verified.ok) {
              // Recover if webhook / status path already activated.
              const st = await getRazorpayOrderStatus(supabase, orderId);
              if (st.subscriptionActive || st.recovered) {
                settle({
                  ok: true,
                  provider: 'razorpay',
                  providerSubscriptionId: resp.razorpay_payment_id,
                });
                return;
              }
              settle({
                ok: false,
                provider: 'razorpay',
                error: verified.error || 'Payment verification failed',
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
          ondismiss: async () => {
            // User may have completed payment then closed the modal before handler ran.
            try {
              const st = await getRazorpayOrderStatus(supabase, orderId);
              if (st.subscriptionActive || st.recovered) {
                settle({
                  ok: true,
                  provider: 'razorpay',
                  providerSubscriptionId: (st.payment?.razorpay_payment_id as string) || undefined,
                });
                return;
              }
              await markRazorpayOrderCancelled(supabase, orderId);
            } catch {
              /* ignore */
            }
            settle({ ok: false, provider: 'razorpay', error: 'Payment cancelled' });
          },
        },
      });
      rzp.on('payment.failed', (resp: any) => {
        settle({
          ok: false,
          provider: 'razorpay',
          error: friendlyRazorpayCheckoutFailure(resp?.error?.description, { keyId }),
        });
      });
      rzp.open();
    });
  }
}
