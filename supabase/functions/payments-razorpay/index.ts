// Lumixo+ — Razorpay payment verification + subscription activation.
//
// CRITICAL: Never trust the browser for activation. Client sends payment ids;
// this function verifies the HMAC signature with RAZORPAY_KEY_SECRET, then
// calls admin_activate_subscription (service role).
//
// Secrets:
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
// Deploy: supabase functions deploy payments-razorpay

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('PUSH_CORS_ORIGINS') ??
    'https://futurehat-app.netlify.app,https://lumixo.app,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? 'https://futurehat-app.netlify.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'content-type': 'application/json' },
  });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json(req, { ok: true });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json(req, { error: 'Missing authorization' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
    const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';

    if (!KEY_SECRET || !KEY_ID) {
      return json(req, { error: 'Payments not configured' }, 503);
    }

    const asUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData.user;
    if (!user) return json(req, { error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      action?: 'verify' | 'create_order';
      plan?: 'monthly' | 'yearly';
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // ── Create order (preferred checkout path) ─────────────────────────────
    if (body.action === 'create_order') {
      const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';
      // Must match shared/premium/plans.ts amountPaise exactly.
      const amountPaise = plan === 'yearly' ? 24900 : 2500;
      const authBasic = btoa(`${KEY_ID}:${KEY_SECRET}`);
      const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          authorization: `Basic ${authBasic}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: `lumixo_${plan}_${user.id.slice(0, 8)}_${Date.now()}`,
          notes: { user_id: user.id, plan },
        }),
      });
      if (!orderResp.ok) {
        const t = await orderResp.text();
        return json(req, { error: `Order create failed: ${t.slice(0, 200)}` }, 502);
      }
      const order = await orderResp.json();
      return json(req, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: KEY_ID, plan });
    }

    // ── Verify payment signature + activate ────────────────────────────────
    const paymentId = body.razorpay_payment_id ?? '';
    const orderId = body.razorpay_order_id ?? '';
    const signature = body.razorpay_signature ?? '';
    const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';

    if (!paymentId || !signature) {
      return json(req, { error: 'Missing payment proof' }, 400);
    }

    // Order-based checkout: HMAC(order_id|payment_id)
    // Legacy capture-only: if no order, refuse (must use create_order).
    if (!orderId) {
      return json(req, { error: 'Order id required. Restart checkout.' }, 400);
    }

    const expected = await hmacSha256Hex(KEY_SECRET, `${orderId}|${paymentId}`);
    if (expected !== signature) {
      console.warn('[payments] signature mismatch for user', user.id);
      return json(req, { error: 'Payment verification failed' }, 400);
    }

    // Optional: fetch payment from Razorpay to confirm captured amount/status.
    const authBasic = btoa(`${KEY_ID}:${KEY_SECRET}`);
    const payResp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { authorization: `Basic ${authBasic}` },
    });
    if (!payResp.ok) {
      return json(req, { error: 'Could not fetch payment from provider' }, 502);
    }
    const payment = await payResp.json();
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return json(req, { error: `Payment not successful (${payment.status})` }, 400);
    }

    const periodDays = plan === 'yearly' ? 365 : 30;
    const amountInr = Math.round(Number(payment.amount || 0) / 100);

    const { error: actErr } = await admin.rpc('admin_activate_subscription', {
      p_user_id: user.id,
      p_plan: plan,
      p_provider: 'razorpay',
      p_provider_subscription_id: paymentId,
      p_provider_customer_id: payment.email ?? payment.contact ?? null,
      p_amount_inr: amountInr,
      p_period_days: periodDays,
    });

    if (actErr) {
      console.error('[payments] activate failed', actErr.message);
      return json(req, { error: actErr.message }, 500);
    }

    return json(req, { ok: true, plan, paymentId });
  } catch (e) {
    console.error('[payments]', e);
    return json(req, { error: String(e) }, 500);
  }
});
