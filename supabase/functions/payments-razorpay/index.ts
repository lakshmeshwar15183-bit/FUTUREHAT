// Lumixo+ — production Razorpay payments (orders, client verify, webhooks).
//
// SECURITY MODEL
// ──────────────
// • RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET live ONLY as Edge Function secrets.
// • Clients never see KEY_SECRET. KEY_ID is returned only after auth for checkout.
// • Premium is granted ONLY after server verification (HMAC signature and/or
//   Razorpay API payment status) via service-role admin_activate_subscription.
// • Webhooks use RAZORPAY_WEBHOOK_SECRET (dashboard webhook secret) for HMAC
//   of the raw body; falls back to KEY_SECRET only if webhook secret unset.
//
// Actions (authenticated POST JSON):
//   { action: "config" }                         → { configured, keyId }
//   { action: "create_order", plan }             → { orderId, amount, currency, keyId, plan }
//   { action: "verify", razorpay_* }             → { ok, plan, paymentId }
//   { action: "status", razorpay_order_id }      → { payment, subscriptionActive }
//   { action: "mark_cancelled", razorpay_order_id } → { ok } (unpaid orders only)
//
// Webhook (no user JWT; verify_jwt=false + x-razorpay-signature):
//
// Deploy:
//   supabase secrets set RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=...
//   supabase secrets set RAZORPAY_WEBHOOK_SECRET=...   # recommended
//   supabase functions deploy payments-razorpay

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('PUSH_CORS_ORIGINS') ??
    'https://futurehat-app.netlify.app,https://lumixo.app,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const PLAN_AMOUNT_PAISE: Record<'monthly' | 'yearly', number> = {
  monthly: 2500, // ₹25
  yearly: 24900, // ₹249
};

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin)
    ? origin
    : [...ALLOWED_ORIGINS][0] ?? 'https://futurehat-app.netlify.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id',
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

/** User-facing error — never leak secrets, stack traces, or raw provider dumps. */
function clientError(
  req: Request,
  opts: { status: number; code: string; message: string; log?: string },
) {
  if (opts.log) {
    console.error(`[payments] ${opts.code} status=${opts.status}`, opts.log.slice(0, 500));
  } else {
    console.error(`[payments] ${opts.code} status=${opts.status}`);
  }
  return json(
    req,
    {
      ok: false,
      error: opts.message,
      code: opts.code,
      status: opts.status,
    },
    opts.status,
  );
}

function friendlyProviderOrderError(status: number, body: string): { code: string; message: string } {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403 || /authentication|invalid key|auth/i.test(lower)) {
    return {
      code: 'gateway_auth',
      message: 'Payment gateway is not configured correctly. Please try again later.',
    };
  }
  if (status === 429 || /rate/i.test(lower)) {
    return {
      code: 'gateway_rate',
      message: 'Too many payment attempts. Please wait a moment and try again.',
    };
  }
  if (status >= 500) {
    return {
      code: 'gateway_down',
      message: 'Payment service is temporarily unavailable. Please try again shortly.',
    };
  }
  return {
    code: 'order_failed',
    message: 'Could not start checkout. Please try again.',
  };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
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

function planFromAmountPaise(amountPaise: number): 'monthly' | 'yearly' | null {
  if (amountPaise === PLAN_AMOUNT_PAISE.yearly) return 'yearly';
  if (amountPaise === PLAN_AMOUNT_PAISE.monthly) return 'monthly';
  return null;
}

function rzpAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function rzpFetch(
  path: string,
  keyId: string,
  keySecret: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      authorization: rzpAuthHeader(keyId, keySecret),
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, service, { auth: { persistSession: false } });
}

async function recordPayment(
  admin: SupabaseClient,
  args: {
    userId: string;
    orderId: string;
    paymentId?: string | null;
    amount: number;
    currency: string;
    plan: 'monthly' | 'yearly';
    status: string;
    signatureVerified?: boolean;
    activated?: boolean;
    errorCode?: string | null;
    errorDescription?: string | null;
    refundId?: string | null;
    amountRefunded?: number;
    notes?: Record<string, unknown>;
  },
) {
  const { error } = await admin.rpc('admin_record_razorpay_payment', {
    p_user_id: args.userId,
    p_order_id: args.orderId,
    p_payment_id: args.paymentId ?? null,
    p_amount: args.amount,
    p_currency: args.currency,
    p_plan: args.plan,
    p_status: args.status,
    p_signature_verified: args.signatureVerified ?? false,
    p_activated: args.activated ?? false,
    p_error_code: args.errorCode ?? null,
    p_error_description: args.errorDescription ?? null,
    p_refund_id: args.refundId ?? null,
    p_amount_refunded: args.amountRefunded ?? 0,
    p_notes: args.notes ?? {},
  });
  if (error) console.error('[payments] record payment', error.message);
}

async function activatePremium(
  admin: SupabaseClient,
  args: {
    userId: string;
    plan: 'monthly' | 'yearly';
    paymentId: string;
    customerRef?: string | null;
    amountInr: number;
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const periodDays = args.plan === 'yearly' ? 365 : 30;
  const { error } = await admin.rpc('admin_activate_subscription', {
    p_user_id: args.userId,
    p_plan: args.plan,
    p_provider: 'razorpay',
    p_provider_subscription_id: args.paymentId,
    p_provider_customer_id: args.customerRef ?? null,
    p_amount_inr: args.amountInr,
    p_period_days: periodDays,
  });
  if (error) {
    const msg = error.message ?? 'activation failed';
    const status = /already bound|forbidden/i.test(msg) ? 409 : 500;
    return { ok: false, error: msg, status };
  }
  return { ok: true };
}

/** Shared path: verified payment → ledger + premium. Idempotent. */
async function fulfillCapturedPayment(
  admin: SupabaseClient,
  args: {
    userId: string;
    orderId: string;
    paymentId: string;
    amountPaise: number;
    currency: string;
    plan: 'monthly' | 'yearly';
    customerRef?: string | null;
    signatureVerified: boolean;
    notes?: Record<string, unknown>;
  },
): Promise<{ ok: true; plan: 'monthly' | 'yearly'; paymentId: string } | { ok: false; error: string; status: number }> {
  const amountInr = Math.round(args.amountPaise / 100);

  // Ledger first (idempotent). Activation is still the premium source of truth.
  await recordPayment(admin, {
    userId: args.userId,
    orderId: args.orderId,
    paymentId: args.paymentId,
    amount: args.amountPaise,
    currency: args.currency || 'INR',
    plan: args.plan,
    status: 'captured',
    signatureVerified: args.signatureVerified,
    activated: false,
    notes: args.notes,
  });

  const act = await activatePremium(admin, {
    userId: args.userId,
    plan: args.plan,
    paymentId: args.paymentId,
    customerRef: args.customerRef,
    amountInr,
  });
  if (!act.ok) return act;

  await recordPayment(admin, {
    userId: args.userId,
    orderId: args.orderId,
    paymentId: args.paymentId,
    amount: args.amountPaise,
    currency: args.currency || 'INR',
    plan: args.plan,
    status: 'captured',
    signatureVerified: args.signatureVerified,
    activated: true,
    notes: args.notes,
  });

  return { ok: true, plan: args.plan, paymentId: args.paymentId };
}

async function resolveUserAndPlanFromOrder(
  admin: SupabaseClient,
  keyId: string,
  keySecret: string,
  orderId: string,
  paymentAmountPaise: number,
): Promise<
  | { ok: true; userId: string; plan: 'monthly' | 'yearly'; orderAmount: number; currency: string }
  | { ok: false; error: string; status: number }
> {
  // Prefer our ledger (authoritative for user_id binding).
  const { data: row } = await admin
    .from('razorpay_payments')
    .select('user_id, plan, amount, currency, status')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();

  if (row?.user_id) {
    const plan = planFromAmountPaise(paymentAmountPaise);
    if (!plan) return { ok: false, error: 'Payment amount does not match a plan', status: 400 };
    if (Number(row.amount) !== paymentAmountPaise) {
      return { ok: false, error: 'Payment amount does not match order', status: 400 };
    }
    if (row.plan && row.plan !== plan) {
      return { ok: false, error: 'Order plan does not match payment amount', status: 400 };
    }
    return {
      ok: true,
      userId: row.user_id as string,
      plan: (row.plan as 'monthly' | 'yearly') || plan,
      orderAmount: Number(row.amount),
      currency: (row.currency as string) || 'INR',
    };
  }

  // Fallback: Razorpay order notes (for orders created before ledger migration).
  const orderResp = await rzpFetch(`/orders/${orderId}`, keyId, keySecret);
  if (!orderResp.ok) {
    return { ok: false, error: 'Could not fetch order from provider', status: 502 };
  }
  const order = await orderResp.json();
  const userId = String(order?.notes?.user_id || '');
  if (!userId) return { ok: false, error: 'Order has no bound user', status: 400 };
  const orderAmount = Number(order.amount || 0);
  if (orderAmount !== paymentAmountPaise) {
    return { ok: false, error: 'Payment amount does not match order', status: 400 };
  }
  const plan = planFromAmountPaise(paymentAmountPaise);
  if (!plan) return { ok: false, error: 'Payment amount does not match a plan', status: 400 };
  const notesPlan =
    order?.notes?.plan === 'yearly' ? 'yearly' : order?.notes?.plan === 'monthly' ? 'monthly' : null;
  if (notesPlan && notesPlan !== plan) {
    return { ok: false, error: 'Order plan does not match payment amount', status: 400 };
  }
  return {
    ok: true,
    userId,
    plan,
    orderAmount,
    currency: String(order.currency || 'INR'),
  };
}

// ── Webhook handler ───────────────────────────────────────────────────────────
async function handleWebhook(req: Request, rawBody: string): Promise<Response> {
  const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
  const WEBHOOK_SECRET =
    Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? KEY_SECRET;

  if (!KEY_ID || !KEY_SECRET) {
    return json(req, { error: 'Payments not configured' }, 503);
  }
  if (!WEBHOOK_SECRET) {
    return json(req, { error: 'Webhook secret not configured' }, 503);
  }

  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!signature) return json(req, { error: 'Missing signature' }, 400);

  const expected = await hmacSha256Hex(WEBHOOK_SECRET, rawBody);
  if (!timingSafeEqualHex(expected, signature)) {
    console.warn('[payments] webhook signature mismatch');
    return json(req, { error: 'Invalid webhook signature' }, 400);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(req, { error: 'Invalid JSON' }, 400);
  }

  const eventType = String(payload?.event || 'unknown');
  const paymentEntity = payload?.payload?.payment?.entity;
  const refundEntity = payload?.payload?.refund?.entity;
  const orderEntity = payload?.payload?.order?.entity;

  const paymentId = String(paymentEntity?.id || refundEntity?.payment_id || '');
  const orderId = String(paymentEntity?.order_id || orderEntity?.id || '');
  // Stable id — never Date.now() (would break idempotency on Razorpay retries).
  const eventId =
    (req.headers.get('x-razorpay-event-id') || '').trim() ||
    String(payload?.id || '').trim() ||
    `${eventType}:${paymentId || refundEntity?.id || 'nopay'}:${orderId || 'noord'}`;

  const admin = serviceClient();

  const { data: claimed, error: claimErr } = await admin.rpc('admin_claim_razorpay_webhook', {
    p_event_id: eventId,
    p_event_type: eventType,
    p_payment_id: paymentId || null,
    p_order_id: orderId || null,
    p_payload: payload,
  });
  if (claimErr) {
    console.error('[payments] webhook claim', claimErr.message);
    return json(req, { error: 'Webhook claim failed' }, 500);
  }
  if (claimed === false) {
    // Distinguish "already done" (ack 200) vs "in flight / failed pending retry" (409).
    // Returning 200 for in-flight would stop Razorpay from retrying a crashed worker.
    const { data: ev } = await admin
      .from('razorpay_webhook_events')
      .select('processed, process_error')
      .eq('event_id', eventId)
      .maybeSingle();
    if (ev?.processed === true) {
      return json(req, { ok: true, duplicate: true });
    }
    return json(req, { error: 'event processing in progress or pending retry' }, 409);
  }

  try {
    if (
      eventType === 'payment.captured' ||
      eventType === 'order.paid' ||
      eventType === 'payment.authorized'
    ) {
      // Resolve a concrete payment id: payment.* entities, or order.paid → list payments.
      let paymentIdToFetch = paymentEntity?.id ? String(paymentEntity.id) : '';
      let orderIdHint = paymentEntity?.order_id
        ? String(paymentEntity.order_id)
        : orderEntity?.id
          ? String(orderEntity.id)
          : '';

      if (!paymentIdToFetch && eventType === 'order.paid' && orderIdHint) {
        const pays = await rzpFetch(`/orders/${orderIdHint}/payments`, KEY_ID, KEY_SECRET);
        if (!pays.ok) throw new Error('Could not list order payments from provider');
        const list = await pays.json();
        const captured = (list.items || []).find(
          (p: any) => p.status === 'captured' || p.status === 'authorized',
        );
        if (!captured?.id) {
          await admin.rpc('admin_mark_razorpay_webhook_processed', {
            p_event_id: eventId,
            p_error: null,
          });
          return json(req, { ok: true, skipped: true, reason: 'no_captured_payment' });
        }
        paymentIdToFetch = String(captured.id);
      }

      if (!paymentIdToFetch) {
        await admin.rpc('admin_mark_razorpay_webhook_processed', {
          p_event_id: eventId,
          p_error: 'missing payment entity',
        });
        return json(req, { ok: true, skipped: true });
      }

      // Always re-fetch from API (never trust webhook body alone for amount/status).
      const payResp = await rzpFetch(`/payments/${paymentIdToFetch}`, KEY_ID, KEY_SECRET);
      if (!payResp.ok) throw new Error('Could not fetch payment from provider');
      const payment = await payResp.json();
      if (payment.status !== 'captured' && payment.status !== 'authorized') {
        const midAmount = Number(payment.amount || 0);
        const midPlan = planFromAmountPaise(midAmount) ?? 'monthly';
        const resolvedMid = await resolveUserAndPlanFromOrder(
          admin,
          KEY_ID,
          KEY_SECRET,
          String(payment.order_id || orderIdHint),
          midAmount > 0 ? midAmount : PLAN_AMOUNT_PAISE[midPlan],
        );
        if (resolvedMid.ok) {
          await recordPayment(admin, {
            userId: resolvedMid.userId,
            orderId: String(payment.order_id || orderIdHint),
            paymentId: payment.id,
            amount: midAmount > 0 ? midAmount : PLAN_AMOUNT_PAISE[midPlan],
            currency: String(payment.currency || 'INR'),
            plan: resolvedMid.plan,
            status: payment.status === 'failed' ? 'failed' : 'attempted',
            signatureVerified: true,
            errorDescription: `webhook status ${payment.status}`,
          });
        }
        await admin.rpc('admin_mark_razorpay_webhook_processed', {
          p_event_id: eventId,
          p_error: null,
        });
        return json(req, { ok: true, status: payment.status });
      }

      const amountPaise = Number(payment.amount || 0);
      const resolved = await resolveUserAndPlanFromOrder(
        admin,
        KEY_ID,
        KEY_SECRET,
        String(payment.order_id),
        amountPaise,
      );
      if (!resolved.ok) throw new Error(resolved.error);

      // If authorized only, try capture (Orders flow usually auto-captures).
      if (payment.status === 'authorized') {
        const cap = await rzpFetch(`/payments/${payment.id}/capture`, KEY_ID, KEY_SECRET, {
          method: 'POST',
          body: JSON.stringify({ amount: amountPaise, currency: payment.currency || 'INR' }),
        });
        if (!cap.ok) {
          console.warn('[payments] capture after authorized failed', await cap.text());
        }
      }

      const result = await fulfillCapturedPayment(admin, {
        userId: resolved.userId,
        orderId: String(payment.order_id),
        paymentId: String(payment.id),
        amountPaise,
        currency: String(payment.currency || 'INR'),
        plan: resolved.plan,
        customerRef: payment.email ?? payment.contact ?? null,
        signatureVerified: true,
        notes: { source: 'webhook', event: eventType },
      });
      if (!result.ok) throw new Error(result.error);

      await admin.rpc('admin_mark_razorpay_webhook_processed', {
        p_event_id: eventId,
        p_error: null,
      });
      return json(req, { ok: true, activated: true, plan: result.plan });
    }

    if (eventType === 'payment.failed') {
      const entity = paymentEntity;
      if (entity?.order_id) {
        const amountPaise = Number(entity.amount || 0);
        const plan = planFromAmountPaise(amountPaise) ?? 'monthly';
        let userId = String(entity.notes?.user_id || '');
        if (!userId) {
          const { data: row } = await admin
            .from('razorpay_payments')
            .select('user_id')
            .eq('razorpay_order_id', entity.order_id)
            .maybeSingle();
          userId = row?.user_id ?? '';
        }
        if (userId) {
          await recordPayment(admin, {
            userId,
            orderId: String(entity.order_id),
            paymentId: entity.id,
            amount: amountPaise || PLAN_AMOUNT_PAISE[plan],
            currency: String(entity.currency || 'INR'),
            plan,
            status: 'failed',
            signatureVerified: true,
            errorCode: entity.error_code ?? null,
            errorDescription: entity.error_description ?? entity.error_reason ?? 'payment failed',
            notes: { source: 'webhook' },
          });
        }
      }
      await admin.rpc('admin_mark_razorpay_webhook_processed', {
        p_event_id: eventId,
        p_error: null,
      });
      return json(req, { ok: true });
    }

    if (
      eventType === 'refund.created' ||
      eventType === 'refund.processed' ||
      eventType === 'payment.refunded'
    ) {
      const refund = refundEntity;
      const payId = String(refund?.payment_id || paymentEntity?.id || '');
      if (payId) {
        const payResp = await rzpFetch(`/payments/${payId}`, KEY_ID, KEY_SECRET);
        if (payResp.ok) {
          const payment = await payResp.json();
          const amountPaise = Number(payment.amount || 0);
          const amountRefunded = Number(payment.amount_refunded || refund?.amount || 0);
          const orderIdResolved = String(payment.order_id || '');
          const resolved = orderIdResolved
            ? await resolveUserAndPlanFromOrder(
              admin,
              KEY_ID,
              KEY_SECRET,
              orderIdResolved,
              amountPaise,
            )
            : null;

          if (resolved && resolved.ok) {
            const fullyRefunded = amountRefunded >= amountPaise && amountPaise > 0;
            await recordPayment(admin, {
              userId: resolved.userId,
              orderId: orderIdResolved,
              paymentId: payId,
              amount: amountPaise,
              currency: String(payment.currency || 'INR'),
              plan: resolved.plan,
              status: fullyRefunded ? 'refunded' : 'captured',
              signatureVerified: true,
              refundId: refund?.id ?? null,
              amountRefunded,
              notes: { source: 'webhook', event: eventType },
            });
            if (fullyRefunded) {
              await admin.rpc('admin_revoke_premium_for_payment', {
                p_user_id: resolved.userId,
                p_payment_id: payId,
              });
            }
          }
        }
      }
      await admin.rpc('admin_mark_razorpay_webhook_processed', {
        p_event_id: eventId,
        p_error: null,
      });
      return json(req, { ok: true });
    }

    // Unhandled event types — acknowledge so Razorpay stops retrying.
    await admin.rpc('admin_mark_razorpay_webhook_processed', {
      p_event_id: eventId,
      p_error: null,
    });
    return json(req, { ok: true, ignored: eventType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[payments] webhook process', msg);
    await admin.rpc('admin_mark_razorpay_webhook_processed', {
      p_event_id: eventId,
      p_error: msg.slice(0, 500),
    });
    return json(req, { error: msg }, 500);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json(req, { ok: true });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const rawBody = await req.text();
  const hasWebhookSig = !!req.headers.get('x-razorpay-signature');
  // Razorpay webhooks: signature header present, typically no user JWT.
  if (hasWebhookSig && !req.headers.get('Authorization')?.startsWith('Bearer ey')) {
    // Heuristic: if body looks like a Razorpay event, treat as webhook.
    // Also accept when Authorization is the service/anon key only (no user JWT).
  }
  if (hasWebhookSig) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.event && parsed?.payload) {
        return await handleWebhook(req, rawBody);
      }
    } catch {
      // fall through to authenticated API
    }
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return clientError(req, {
        status: 401,
        code: 'missing_auth',
        message: 'Please sign in to continue checkout.',
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
    const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';

    if (!SUPABASE_URL || !ANON) {
      return clientError(req, {
        status: 503,
        code: 'server_misconfigured',
        message: 'Payments are temporarily unavailable. Please try again later.',
        log: 'missing SUPABASE_URL or SUPABASE_ANON_KEY',
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return clientError(req, {
        status: 401,
        code: 'missing_auth',
        message: 'Please sign in to continue checkout.',
      });
    }

    const asUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Pass JWT explicitly — more reliable on Edge than session-based getUser().
    const { data: userData, error: authErr } = await asUser.auth.getUser(jwt);
    const user = userData?.user ?? null;
    if (authErr || !user?.id) {
      return clientError(req, {
        status: 401,
        code: 'unauthorized',
        message: 'Your session expired. Please sign in again and retry payment.',
        log: authErr?.message ?? 'no user on getUser(jwt)',
      });
    }

    let body: {
      action?: 'verify' | 'create_order' | 'config' | 'status' | 'mark_cancelled';
      plan?: 'monthly' | 'yearly';
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    } = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return clientError(req, {
        status: 400,
        code: 'invalid_json',
        message: 'Invalid request. Please try again.',
      });
    }

    // ── Config (no secrets beyond public key id) ───────────────────────────
    if (body.action === 'config') {
      const configured = !!(KEY_ID && KEY_SECRET);
      console.log('[payments] config user=', user.id.slice(0, 8), 'configured=', configured);
      return json(req, {
        ok: true,
        configured,
        // Public key id only — safe for checkout; secret never returned.
        keyId: configured ? KEY_ID : null,
        plans: {
          monthly: { amountPaise: PLAN_AMOUNT_PAISE.monthly, currency: 'INR' },
          yearly: { amountPaise: PLAN_AMOUNT_PAISE.yearly, currency: 'INR' },
        },
      });
    }

    if (!KEY_SECRET || !KEY_ID) {
      return clientError(req, {
        status: 503,
        code: 'payments_not_configured',
        message: 'Secure payments are not available yet. Please try again later.',
        log: `KEY_ID set=${!!KEY_ID} KEY_SECRET set=${!!KEY_SECRET}`,
      });
    }

    const admin = serviceClient();

    // ── Create order ───────────────────────────────────────────────────────
    if (body.action === 'create_order') {
      const plan = body.plan === 'yearly' ? 'yearly' : body.plan === 'monthly' ? 'monthly' : null;
      if (!plan) {
        return clientError(req, {
          status: 400,
          code: 'invalid_plan',
          message: 'Please choose a valid plan.',
        });
      }
      const amountPaise = PLAN_AMOUNT_PAISE[plan];

      console.log(
        '[payments] create_order user=',
        user.id.slice(0, 8),
        'plan=',
        plan,
        'amountPaise=',
        amountPaise,
      );

      let orderResp: Response;
      try {
        orderResp = await rzpFetch('/orders', KEY_ID, KEY_SECRET, {
          method: 'POST',
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: `lumixo_${plan}_${user.id.slice(0, 8)}_${Date.now()}`.slice(0, 40),
            notes: { user_id: user.id, plan, app: 'lumixo' },
          }),
        });
      } catch (e) {
        return clientError(req, {
          status: 502,
          code: 'gateway_network',
          message: 'Could not reach the payment service. Check your connection and try again.',
          log: e instanceof Error ? e.message : 'rzp fetch threw',
        });
      }

      if (!orderResp.ok) {
        const t = await orderResp.text();
        const friendly = friendlyProviderOrderError(orderResp.status, t);
        return clientError(req, {
          status: 502,
          code: friendly.code,
          message: friendly.message,
          log: `razorpay HTTP ${orderResp.status}: ${t.slice(0, 300)}`,
        });
      }
      const order = await orderResp.json();
      if (!order?.id) {
        return clientError(req, {
          status: 502,
          code: 'order_invalid',
          message: 'Could not start checkout. Please try again.',
          log: 'order response missing id',
        });
      }

      // Ledger is required for status / cancel / recovery. Fail hard if we cannot write it
      // (previously we returned orderId while status 404'd with "Order not found").
      let upsertErr: { message?: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await admin.rpc('admin_upsert_razorpay_order', {
          p_user_id: user.id,
          p_order_id: order.id,
          p_amount: amountPaise,
          p_currency: order.currency || 'INR',
          p_plan: plan,
          p_notes: { receipt: order.receipt ?? null },
        });
        upsertErr = res.error;
        if (!upsertErr) break;
        console.error('[payments] ledger order attempt', attempt + 1, upsertErr.message);
      }
      if (upsertErr) {
        return clientError(req, {
          status: 500,
          code: 'ledger_write_failed',
          message: 'Could not start checkout. Please try again.',
          log: upsertErr.message ?? 'admin_upsert_razorpay_order failed',
        });
      }

      console.log('[payments] order ok', order.id, 'user=', user.id.slice(0, 8));
      return json(req, {
        ok: true,
        orderId: order.id,
        amount: order.amount ?? amountPaise,
        currency: order.currency || 'INR',
        keyId: KEY_ID,
        plan,
      });
    }

    // ── Mark checkout cancelled (user dismissed before pay) ────────────────
    if (body.action === 'mark_cancelled') {
      const orderId = body.razorpay_order_id ?? '';
      if (!orderId) {
        return clientError(req, {
          status: 400,
          code: 'order_id_required',
          message: 'Order id required.',
        });
      }
      const { data: row } = await admin
        .from('razorpay_payments')
        .select('user_id, status, amount, plan, currency')
        .eq('razorpay_order_id', orderId)
        .eq('user_id', user.id)
        .maybeSingle();
      // Soft miss — dismiss must never surface a harsh 404 after a failed/partial checkout.
      if (!row) return json(req, { ok: true, skipped: true, status: 'missing' });
      // Never cancel a paid row — status recovery / verify own those.
      if (row.status === 'captured' || row.status === 'refunded' || row.status === 'authorized') {
        return json(req, { ok: true, skipped: true, status: row.status });
      }
      await recordPayment(admin, {
        userId: user.id,
        orderId,
        amount: Number(row.amount),
        currency: String(row.currency || 'INR'),
        plan: (row.plan as 'monthly' | 'yearly') || 'monthly',
        status: 'cancelled',
        notes: { source: 'client_cancel' },
      });
      return json(req, { ok: true, status: 'cancelled' });
    }

    // ── Status / retry helper ──────────────────────────────────────────────
    if (body.action === 'status') {
      const orderId = body.razorpay_order_id ?? '';
      if (!orderId) {
        return clientError(req, {
          status: 400,
          code: 'order_id_required',
          message: 'Order id required.',
        });
      }

      let { data: row } = await admin
        .from('razorpay_payments')
        .select('*')
        .eq('razorpay_order_id', orderId)
        .eq('user_id', user.id)
        .maybeSingle();

      // Ledger miss: recover from Razorpay order notes (user_id bound at create_order).
      // Fixes "Order not found" when create_order returned but upsert failed, or migration lag.
      if (!row) {
        const orderResp = await rzpFetch(`/orders/${orderId}`, KEY_ID, KEY_SECRET);
        if (!orderResp.ok) {
          return clientError(req, {
            status: 404,
            code: 'order_not_found',
            message:
              'We could not find this checkout session. Start a new payment if you still want Premium.',
            log: `status ledger miss + rzp HTTP ${orderResp.status}`,
          });
        }
        const rzpOrder = await orderResp.json();
        const notesUser = String(rzpOrder?.notes?.user_id || '');
        if (notesUser !== user.id) {
          return clientError(req, {
            status: 404,
            code: 'order_not_found',
            message:
              'We could not find this checkout session. Start a new payment if you still want Premium.',
            log: 'status ledger miss + notes user mismatch',
          });
        }
        const amountPaise = Number(rzpOrder.amount || 0);
        const planFromAmt = planFromAmountPaise(amountPaise);
        const notesPlan =
          rzpOrder?.notes?.plan === 'yearly'
            ? 'yearly'
            : rzpOrder?.notes?.plan === 'monthly'
              ? 'monthly'
              : null;
        const plan = planFromAmt || notesPlan || 'monthly';
        if (amountPaise > 0) {
          await admin.rpc('admin_upsert_razorpay_order', {
            p_user_id: user.id,
            p_order_id: orderId,
            p_amount: amountPaise,
            p_currency: String(rzpOrder.currency || 'INR'),
            p_plan: plan,
            p_notes: {
              receipt: rzpOrder.receipt ?? null,
              source: 'status_backfill',
            },
          });
          const refreshed = await admin
            .from('razorpay_payments')
            .select('*')
            .eq('razorpay_order_id', orderId)
            .eq('user_id', user.id)
            .maybeSingle();
          row = refreshed.data;
        }
        if (!row) {
          // Still no ledger — return soft unpaid status from gateway so UI does not hard-fail.
          const { data: subMiss } = await admin
            .from('subscriptions')
            .select('status, current_period_end')
            .eq('user_id', user.id)
            .maybeSingle();
          const subActiveMiss =
            subMiss?.status === 'active' &&
            subMiss?.current_period_end &&
            new Date(subMiss.current_period_end).getTime() > Date.now();
          return json(req, {
            payment: {
              razorpay_order_id: orderId,
              status: String(rzpOrder.status || 'created'),
              amount: amountPaise,
              currency: String(rzpOrder.currency || 'INR'),
              plan,
              source: 'razorpay_only',
            },
            subscriptionActive: !!subActiveMiss,
            recovered: false,
          });
        }
      }

      // If captured in ledger, premium should already be active.
      // If order is paid at Razorpay but verify never completed, finish now.
      if (row.status !== 'captured' && row.status !== 'refunded') {
        const orderResp = await rzpFetch(`/orders/${orderId}`, KEY_ID, KEY_SECRET);
        if (orderResp.ok) {
          const order = await orderResp.json();
          if (order.status === 'paid') {
            const pays = await rzpFetch(
              `/orders/${orderId}/payments`,
              KEY_ID,
              KEY_SECRET,
            );
            if (pays.ok) {
              const list = await pays.json();
              const captured = (list.items || []).find(
                (p: any) => p.status === 'captured' || p.status === 'authorized',
              );
              if (captured) {
                const amountPaise = Number(captured.amount);
                const planFromAmt = planFromAmountPaise(amountPaise);
                // Reject recovery if amount does not match a known plan or ledger amount.
                if (!planFromAmt || amountPaise !== Number(row.amount)) {
                  console.warn('[payments] status recovery amount mismatch', amountPaise, row.amount);
                } else {
                  const fulfilled = await fulfillCapturedPayment(admin, {
                    userId: user.id,
                    orderId,
                    paymentId: captured.id,
                    amountPaise,
                    currency: String(captured.currency || 'INR'),
                    plan: planFromAmt,
                    customerRef: captured.email ?? captured.contact ?? null,
                    signatureVerified: false, // API status path (still server-side)
                    notes: { source: 'status_retry' },
                  });
                  if (fulfilled.ok) {
                    return json(req, {
                      payment: {
                        ...row,
                        status: 'captured',
                        razorpay_payment_id: captured.id,
                        activated: true,
                      },
                      subscriptionActive: true,
                      recovered: true,
                    });
                  }
                }
              }
            }
          }
        }
      }

      const { data: sub } = await admin
        .from('subscriptions')
        .select('status, current_period_end')
        .eq('user_id', user.id)
        .maybeSingle();
      const subscriptionActive =
        sub?.status === 'active' &&
        sub?.current_period_end &&
        new Date(sub.current_period_end).getTime() > Date.now();

      return json(req, { payment: row, subscriptionActive: !!subscriptionActive });
    }

    // ── Verify payment signature + activate ────────────────────────────────
    const paymentId = body.razorpay_payment_id ?? '';
    const orderId = body.razorpay_order_id ?? '';
    const signature = body.razorpay_signature ?? '';
    // NEVER trust body.plan for period — attacker could pay monthly and claim yearly.

    if (!paymentId || !signature) {
      return json(req, { error: 'Missing payment proof' }, 400);
    }
    if (!orderId) {
      return json(req, { error: 'Order id required. Restart checkout.' }, 400);
    }

    const expected = await hmacSha256Hex(KEY_SECRET, `${orderId}|${paymentId}`);
    if (!timingSafeEqualHex(expected, signature)) {
      console.warn('[payments] signature mismatch for user', user.id);
      // Do NOT mark the order failed — a bad signature must not poison a later
      // valid verify/webhook. Log only via attempted + note when row exists.
      const { data: existing } = await admin
        .from('razorpay_payments')
        .select('amount, plan, currency, status')
        .eq('razorpay_order_id', orderId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing?.amount && existing.status === 'created') {
        await recordPayment(admin, {
          userId: user.id,
          orderId,
          paymentId,
          amount: Number(existing.amount),
          currency: String(existing.currency || 'INR'),
          plan: (existing.plan as 'monthly' | 'yearly') || 'monthly',
          status: 'attempted',
          signatureVerified: false,
          errorDescription: 'signature mismatch',
          notes: { last_error: 'signature_mismatch' },
        });
      }
      return json(req, { error: 'Payment verification failed' }, 400);
    }

    const payResp = await rzpFetch(`/payments/${paymentId}`, KEY_ID, KEY_SECRET);
    if (!payResp.ok) {
      return json(req, { error: 'Could not fetch payment from provider' }, 502);
    }
    const payment = await payResp.json();

    if (payment.status === 'failed') {
      const failAmount = Number(payment.amount || 0);
      const failPlan = planFromAmountPaise(failAmount) ?? 'monthly';
      await recordPayment(admin, {
        userId: user.id,
        orderId,
        paymentId,
        amount: failAmount > 0 ? failAmount : PLAN_AMOUNT_PAISE[failPlan],
        currency: String(payment.currency || 'INR'),
        plan: failPlan,
        status: 'failed',
        signatureVerified: true,
        errorCode: payment.error_code ?? null,
        errorDescription: payment.error_description ?? 'payment failed',
      });
      return clientError(req, {
        status: 400,
        code: 'payment_failed',
        message: 'Payment failed. Please try again with another method.',
        log: `rzp failed code=${payment.error_code ?? ''} desc=${String(payment.error_description ?? '').slice(0, 120)}`,
      });
    }

    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      const midAmount = Number(payment.amount || 0);
      const midPlan = planFromAmountPaise(midAmount) ?? 'monthly';
      await recordPayment(admin, {
        userId: user.id,
        orderId,
        paymentId,
        amount: midAmount > 0 ? midAmount : PLAN_AMOUNT_PAISE[midPlan],
        currency: String(payment.currency || 'INR'),
        plan: midPlan,
        status: 'attempted',
        signatureVerified: true,
        errorDescription: `status ${payment.status}`,
      });
      return clientError(req, {
        status: 400,
        code: 'payment_incomplete',
        message: 'Payment was not completed. Please try again.',
        log: `payment status=${payment.status}`,
      });
    }

    if (String(payment.order_id || '') !== orderId) {
      return clientError(req, {
        status: 400,
        code: 'order_mismatch',
        message: 'Payment does not match this order. Please restart checkout.',
        log: `payment/order mismatch pay=${paymentId} order=${orderId} user=${user.id.slice(0, 8)}`,
      });
    }

    // Capture if only authorized.
    if (payment.status === 'authorized') {
      const amountPaise = Number(payment.amount || 0);
      const cap = await rzpFetch(`/payments/${paymentId}/capture`, KEY_ID, KEY_SECRET, {
        method: 'POST',
        body: JSON.stringify({ amount: amountPaise, currency: payment.currency || 'INR' }),
      });
      if (!cap.ok) {
        const t = await cap.text();
        console.warn('[payments] capture failed', t.slice(0, 200));
      }
    }

    const amountPaise = Number(payment.amount || 0);
    const resolved = await resolveUserAndPlanFromOrder(
      admin,
      KEY_ID,
      KEY_SECRET,
      orderId,
      amountPaise,
    );
    if (!resolved.ok) {
      return clientError(req, {
        status: resolved.status,
        code: 'order_resolve_failed',
        message: 'Could not verify this payment. Please contact support if you were charged.',
        log: resolved.error,
      });
    }

    if (resolved.userId !== user.id) {
      return clientError(req, {
        status: 403,
        code: 'order_user_mismatch',
        message: 'This order does not belong to your account.',
        log: `order user mismatch resolved=${resolved.userId.slice(0, 8)} auth=${user.id.slice(0, 8)}`,
      });
    }

    const result = await fulfillCapturedPayment(admin, {
      userId: user.id,
      orderId,
      paymentId,
      amountPaise,
      currency: String(payment.currency || 'INR'),
      plan: resolved.plan,
      customerRef: payment.email ?? payment.contact ?? null,
      signatureVerified: true,
      notes: { source: 'client_verify' },
    });

    if (!result.ok) {
      return clientError(req, {
        status: result.status >= 500 ? 500 : result.status,
        code: result.status === 409 ? 'activation_conflict' : 'activation_failed',
        message:
          result.status === 409
            ? 'This payment is already linked to another subscription. Contact support if needed.'
            : 'Payment received but activation failed. Please reopen Lumixo+ or contact support.',
        log: result.error,
      });
    }

    return json(req, { ok: true, plan: result.plan, paymentId: result.paymentId });
  } catch (e) {
    return clientError(req, {
      status: 500,
      code: 'internal',
      message: 'Something went wrong with payments. Please try again.',
      log: e instanceof Error ? e.message : String(e),
    });
  }
});
