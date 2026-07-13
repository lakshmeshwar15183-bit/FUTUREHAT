// Lumixo+ — client API for Razorpay (no secrets).
//
// All money-critical work happens in the `payments-razorpay` Edge Function.
// Clients only:
//   1) ask whether payments are configured
//   2) create a server-side Order
//   3) open Razorpay Checkout with the public key_id + order_id
//   4) send payment ids + signature back for server HMAC verification
//
// KEY_SECRET and WEBHOOK_SECRET never leave the server.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanId } from '../types.js';

export interface RazorpayConfig {
  configured: boolean;
  keyId: string | null;
  plans: {
    monthly: { amountPaise: number; currency: string };
    yearly: { amountPaise: number; currency: string };
  };
}

export interface RazorpayOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  plan: PlanId;
}

export interface RazorpayVerifyInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayVerifyResult {
  ok: boolean;
  plan?: PlanId;
  paymentId?: string;
  error?: string;
}

function fnErrorMessage(err: unknown, data: any, fallback: string): string {
  if (data?.error && typeof data.error === 'string') return data.error;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = String((err as { message?: string }).message || '');
    if (m) return m;
  }
  return fallback;
}

/** Public config: whether server has Razorpay secrets (never returns secret). */
export async function getRazorpayConfig(
  client: SupabaseClient,
): Promise<{ config: RazorpayConfig | null; error: Error | null }> {
  try {
    const { data, error } = await client.functions.invoke('payments-razorpay', {
      body: { action: 'config' },
    });
    if (error) {
      return { config: null, error: new Error(fnErrorMessage(error, data, 'Could not load payment config')) };
    }
    return {
      config: {
        configured: !!data?.configured,
        keyId: data?.keyId ?? null,
        plans: data?.plans ?? {
          monthly: { amountPaise: 2500, currency: 'INR' },
          yearly: { amountPaise: 24900, currency: 'INR' },
        },
      },
      error: null,
    };
  } catch (e: any) {
    return { config: null, error: new Error(e?.message || 'Network error loading payment config') };
  }
}

/** Create a Razorpay Order on the server (amount bound to plan server-side). */
export async function createRazorpayOrder(
  client: SupabaseClient,
  plan: PlanId,
): Promise<{ order: RazorpayOrder | null; error: Error | null }> {
  try {
    const { data, error } = await client.functions.invoke('payments-razorpay', {
      body: { action: 'create_order', plan },
    });
    if (error || !data?.orderId) {
      return {
        order: null,
        error: new Error(fnErrorMessage(error, data, 'Could not start secure checkout')),
      };
    }
    return {
      order: {
        orderId: data.orderId as string,
        amount: Number(data.amount),
        currency: String(data.currency || 'INR'),
        keyId: String(data.keyId),
        plan: (data.plan === 'yearly' ? 'yearly' : 'monthly') as PlanId,
      },
      error: null,
    };
  } catch (e: any) {
    return { order: null, error: new Error(e?.message || 'Network error starting checkout') };
  }
}

/**
 * Verify payment signature + activate premium server-side.
 * Safe to retry — activation is idempotent per payment id.
 */
export async function verifyRazorpayPayment(
  client: SupabaseClient,
  proof: RazorpayVerifyInput,
): Promise<RazorpayVerifyResult> {
  try {
    const { data, error } = await client.functions.invoke('payments-razorpay', {
      body: {
        action: 'verify',
        razorpay_order_id: proof.razorpay_order_id,
        razorpay_payment_id: proof.razorpay_payment_id,
        razorpay_signature: proof.razorpay_signature,
      },
    });
    if (error || !data?.ok) {
      return {
        ok: false,
        error: fnErrorMessage(error, data, 'Payment verification failed'),
      };
    }
    return {
      ok: true,
      plan: data.plan === 'yearly' ? 'yearly' : 'monthly',
      paymentId: data.paymentId as string | undefined,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error verifying payment' };
  }
}

/**
 * Mark an unpaid order as cancelled when the user dismisses Checkout.
 * No-ops if the order is already captured/refunded (server-side).
 */
export async function markRazorpayOrderCancelled(
  client: SupabaseClient,
  orderId: string,
): Promise<{ ok: boolean; error: Error | null }> {
  try {
    const { data, error } = await client.functions.invoke('payments-razorpay', {
      body: { action: 'mark_cancelled', razorpay_order_id: orderId },
    });
    if (error) {
      return { ok: false, error: new Error(fnErrorMessage(error, data, 'Could not mark cancelled')) };
    }
    return { ok: !!data?.ok || !!data?.skipped, error: null };
  } catch (e: any) {
    return { ok: false, error: new Error(e?.message || 'Network error marking cancelled') };
  }
}

/**
 * Poll order status / recover activation if Checkout closed after pay
 * but before client verify completed.
 */
export async function getRazorpayOrderStatus(
  client: SupabaseClient,
  orderId: string,
): Promise<{
  payment: Record<string, unknown> | null;
  subscriptionActive: boolean;
  recovered?: boolean;
  error: Error | null;
}> {
  try {
    const { data, error } = await client.functions.invoke('payments-razorpay', {
      body: { action: 'status', razorpay_order_id: orderId },
    });
    if (error) {
      return {
        payment: null,
        subscriptionActive: false,
        error: new Error(fnErrorMessage(error, data, 'Could not load payment status')),
      };
    }
    return {
      payment: (data?.payment as Record<string, unknown>) ?? null,
      subscriptionActive: !!data?.subscriptionActive,
      recovered: !!data?.recovered,
      error: null,
    };
  } catch (e: any) {
    return {
      payment: null,
      subscriptionActive: false,
      error: new Error(e?.message || 'Network error checking payment status'),
    };
  }
}
