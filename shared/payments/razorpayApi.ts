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
// UI must NEVER show raw "Edge Function returned a non-2xx status code".

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
  code?: string;
  status?: number;
}

/** Map backend codes / HTTP status to short user-facing copy. */
function friendlyFromCode(code?: string, status?: number, serverMsg?: string): string {
  switch (code) {
    case 'missing_auth':
    case 'unauthorized':
      return 'Please sign in again to continue checkout.';
    case 'payments_not_configured':
    case 'server_misconfigured':
    case 'gateway_auth':
      return 'Secure payments are temporarily unavailable. Please try again later.';
    case 'gateway_rate':
      return 'Too many payment attempts. Please wait a moment and try again.';
    case 'gateway_down':
    case 'gateway_network':
      return 'Payment service is temporarily unavailable. Please try again shortly.';
    case 'invalid_plan':
      return 'Please choose a valid plan.';
    case 'order_failed':
    case 'order_invalid':
      return 'Could not start checkout. Please try again.';
    case 'invalid_json':
      return 'Invalid request. Please try again.';
    case 'payment_failed':
      return 'Payment failed. Please try again with another method.';
    case 'payment_incomplete':
      return 'Payment was not completed. Please try again.';
    case 'order_mismatch':
    case 'order_resolve_failed':
      return 'Could not verify this payment. Please contact support if you were charged.';
    case 'order_user_mismatch':
      return 'This order does not belong to your account.';
    case 'activation_conflict':
      return 'This payment is already linked to another subscription. Contact support if needed.';
    case 'activation_failed':
      return 'Payment received but activation failed. Please reopen Lumixo+ or contact support.';
    case 'internal':
      return 'Something went wrong with payments. Please try again.';
    default:
      break;
  }
  if (status === 401 || status === 403) return 'Please sign in again to continue checkout.';
  if (status === 503) return 'Secure payments are temporarily unavailable. Please try again later.';
  if (status === 429) return 'Too many payment attempts. Please wait a moment and try again.';
  if (status && status >= 500) return 'Payment service is temporarily unavailable. Please try again shortly.';
  // Prefer a clean server message if it doesn't look like a raw platform dump.
  if (
    serverMsg &&
    !/edge function|non-2xx|functions\.invoke|fetch failed|network request failed/i.test(serverMsg)
  ) {
    return serverMsg.slice(0, 180);
  }
  return 'Something went wrong with payments. Please try again.';
}

/**
 * Extract JSON body + status from supabase-js Functions error.
 * On non-2xx, `data` is often null; the real payload is on `error.context` (Response).
 */
async function parseFunctionsError(
  err: unknown,
  data: unknown,
): Promise<{ message?: string; code?: string; status?: number }> {
  const fromData = data as { error?: string; code?: string; status?: number } | null;
  if (fromData?.error) {
    return { message: fromData.error, code: fromData.code, status: fromData.status };
  }

  const e = err as {
    message?: string;
    context?: Response | { json?: () => Promise<unknown>; status?: number };
    status?: number;
  } | null;

  let status = typeof e?.status === 'number' ? e.status : undefined;
  let message: string | undefined;
  let code: string | undefined;

  const ctx = e?.context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      status = status ?? (ctx as Response).status;
      const j = (await (ctx as Response).json()) as {
        error?: string;
        code?: string;
        status?: number;
      };
      if (j?.error) message = j.error;
      if (j?.code) code = j.code;
      if (typeof j?.status === 'number') status = j.status;
    } catch {
      /* body not JSON */
    }
  }

  if (!message && e?.message && !/non-2xx/i.test(e.message)) {
    message = e.message;
  }

  return { message, code, status };
}

async function invokeError(
  err: unknown,
  data: unknown,
  fallback: string,
): Promise<Error & { code?: string; status?: number }> {
  const parsed = await parseFunctionsError(err, data);
  const text = friendlyFromCode(parsed.code, parsed.status, parsed.message) || fallback;
  const out = new Error(text) as Error & { code?: string; status?: number };
  out.code = parsed.code;
  out.status = parsed.status;
  return out;
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
      return { config: null, error: await invokeError(error, data, 'Could not load payment config') };
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
    return {
      config: null,
      error: new Error(friendlyFromCode(undefined, undefined, e?.message) || 'Network error loading payment config'),
    };
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
        error: await invokeError(error, data, 'Could not start secure checkout'),
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
    return {
      order: null,
      error: new Error(friendlyFromCode(undefined, undefined, e?.message) || 'Network error starting checkout'),
    };
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
      const err = await invokeError(error, data, 'Payment verification failed');
      return {
        ok: false,
        error: err.message,
        code: err.code,
        status: err.status,
      };
    }
    return {
      ok: true,
      plan: data.plan === 'yearly' ? 'yearly' : 'monthly',
      paymentId: data.paymentId as string | undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: friendlyFromCode(undefined, undefined, e?.message) || 'Network error verifying payment',
    };
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
      return { ok: false, error: await invokeError(error, data, 'Could not update payment status') };
    }
    return { ok: !!data?.ok || !!data?.skipped, error: null };
  } catch (e: any) {
    return {
      ok: false,
      error: new Error(friendlyFromCode(undefined, undefined, e?.message) || 'Network error'),
    };
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
        error: await invokeError(error, data, 'Could not load payment status'),
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
      error: new Error(friendlyFromCode(undefined, undefined, e?.message) || 'Network error checking payment'),
    };
  }
}
