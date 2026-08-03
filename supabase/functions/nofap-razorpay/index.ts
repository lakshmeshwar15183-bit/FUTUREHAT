// NoFap Pro — coin packs via Razorpay (reuses Lumixo RAZORPAY_* secrets).
//
// Auth: Firebase ID token in Authorization: Bearer <token>
//   (NoFap uses Firebase Auth, not Supabase Auth.)
//
// Actions (POST JSON):
//   { action: "config" } → { configured, keyId, packages }
//   { action: "create_order", productId } → { orderId, amount, currency, keyId, productId, coins }
//   { action: "verify", productId, orderId, paymentId, signature }
//       → { ok, coinsGranted, productId, paymentId, alreadyCredited }
//
// Deploy:
//   supabase functions deploy nofap-razorpay --no-verify-jwt
//
// Secrets (already set on Lumixo project for payments-razorpay):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// Optional:
//   NOFAP_FIREBASE_API_KEY (defaults to NoFap Pro web API key)

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const NOFAP_FIREBASE_API_KEY =
  Deno.env.get("NOFAP_FIREBASE_API_KEY") ||
  "AIzaSyAf0nWUVmRfNja_zlh2r-9UEt43yxNJ9yc";

/** Authoritative packs — never trust client coin amounts. */
const COIN_PACKAGES: Record<string, { coins: number; priceInr: number }> = {
  coins_60: { coins: 60, priceInr: 29 },
  coins_150: { coins: 150, priceInr: 69 },
  coins_350: { coins: 350, priceInr: 149 },
  coins_800: { coins: 800, priceInr: 299 },
  coins_1500: { coins: 1500, priceInr: 499 },
  coins_3500: { coins: 3500, priceInr: 999 },
};

const ALLOWED_ORIGINS = new Set(
  (
    Deno.env.get("NOFAP_CORS_ORIGINS") ??
    Deno.env.get("PUSH_CORS_ORIGINS") ??
    [
      "https://no-fap-pro.web.app",
      "https://no-fap-pro.firebaseapp.com",
      "http://localhost:5173",
      "http://localhost:4173",
      "http://localhost:3000",
      "https://futurehat-app.netlify.app",
      "https://lumixo.app",
      // Capacitor Android (androidScheme: https)
      "https://localhost",
      "http://localhost",
      "capacitor://localhost",
      "ionic://localhost",
    ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin)
    ? origin
    : [...ALLOWED_ORIGINS][0] ?? "https://no-fap-pro.web.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json" },
  });
}

function clientError(
  req: Request,
  opts: { status: number; code: string; message: string; log?: string },
) {
  if (opts.log) {
    console.error(`[nofap-pay] ${opts.code}`, opts.log.slice(0, 400));
  } else {
    console.error(`[nofap-pay] ${opts.code} status=${opts.status}`);
  }
  return json(
    req,
    { ok: false, error: opts.message, code: opts.code },
    opts.status,
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, service, { auth: { persistSession: false } });
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
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Verify Firebase ID token via Identity Toolkit (public API key). */
async function verifyFirebaseToken(
  idToken: string,
): Promise<{ uid: string; email?: string } | null> {
  if (!idToken || idToken.length < 20) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${NOFAP_FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data?.users?.[0];
    if (!user?.localId) return null;
    return { uid: String(user.localId), email: user.email };
  } catch (e) {
    console.error("[nofap-pay] firebase verify", e);
    return null;
  }
}

function extractBearer(req: Request): string {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return clientError(req, {
      status: 405,
      code: "method_not_allowed",
      message: "POST only",
    });
  }

  const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return clientError(req, {
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON body",
    });
  }

  const action = String(body.action || "");

  // ── config (no auth required — only public key id) ───────────────────────
  if (action === "config") {
    return json(req, {
      ok: true,
      configured: Boolean(KEY_ID && KEY_SECRET),
      keyId: KEY_ID || null,
      packages: Object.fromEntries(
        Object.entries(COIN_PACKAGES).map(([id, p]) => [
          id,
          { coins: p.coins, priceInr: p.priceInr, amountPaise: p.priceInr * 100 },
        ]),
      ),
    });
  }

  if (!KEY_ID || !KEY_SECRET) {
    return clientError(req, {
      status: 503,
      code: "payments_not_configured",
      message: "Payments are not configured on the server.",
    });
  }

  const idToken = extractBearer(req);
  const authed = await verifyFirebaseToken(idToken);
  if (!authed?.uid) {
    return clientError(req, {
      status: 401,
      code: "unauthorized",
      message: "Sign in required.",
    });
  }
  const uid = authed.uid;
  const admin = serviceClient();

  // ── create_order ─────────────────────────────────────────────────────────
  if (action === "create_order") {
    const productId = String(body.productId || "");
    const pkg = COIN_PACKAGES[productId];
    if (!pkg) {
      return clientError(req, {
        status: 400,
        code: "invalid_product",
        message: "Unknown coin pack.",
      });
    }

    const amountPaise = Math.round(pkg.priceInr * 100);
    const receipt = `nf_${uid.slice(0, 8)}_${Date.now()}`.slice(0, 40);

    let order: { id: string; amount: number; currency: string };
    try {
      const resp = await rzpFetch("/orders", KEY_ID, KEY_SECRET, {
        method: "POST",
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt,
          notes: {
            app: "nofap_pro",
            firebase_uid: uid,
            product_id: productId,
            coins: String(pkg.coins),
          },
        }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        return clientError(req, {
          status: 502,
          code: "order_failed",
          message: "Could not start checkout. Please try again.",
          log: text,
        });
      }
      order = JSON.parse(text);
    } catch (e) {
      return clientError(req, {
        status: 502,
        code: "gateway_network",
        message: "Payment service is temporarily unavailable.",
        log: String(e),
      });
    }

    // Ledger open order (service role). Ignore if table missing until migration applied.
    try {
      await admin.from("nofap_razorpay_orders").upsert({
        order_id: order.id,
        firebase_uid: uid,
        product_id: productId,
        amount_paise: amountPaise,
        status: "created",
      });
    } catch (e) {
      console.warn("[nofap-pay] order ledger", e);
    }

    return json(req, {
      ok: true,
      orderId: order.id,
      amount: amountPaise,
      currency: "INR",
      keyId: KEY_ID,
      productId,
      coins: pkg.coins,
    });
  }

  // ── verify ───────────────────────────────────────────────────────────────
  if (action === "verify") {
    const productId = String(body.productId || "");
    const orderId = String(body.orderId || body.razorpay_order_id || "");
    const paymentId = String(body.paymentId || body.razorpay_payment_id || "");
    const signature = String(body.signature || body.razorpay_signature || "");

    const pkg = COIN_PACKAGES[productId];
    if (!pkg) {
      return clientError(req, {
        status: 400,
        code: "invalid_product",
        message: "Unknown coin pack.",
      });
    }
    if (!orderId || !paymentId || !signature) {
      return clientError(req, {
        status: 400,
        code: "missing_fields",
        message: "Missing payment fields.",
      });
    }

    const expected = await hmacSha256Hex(
      KEY_SECRET,
      `${orderId}|${paymentId}`,
    );
    if (!timingSafeEqualHex(expected, signature)) {
      return clientError(req, {
        status: 403,
        code: "invalid_signature",
        message: "Invalid payment signature.",
      });
    }

    // Bind order to this Firebase user
    let boundUid = "";
    let boundProduct = "";
    let boundAmount = 0;

    const { data: row } = await admin
      .from("nofap_razorpay_orders")
      .select("firebase_uid, product_id, amount_paise, status")
      .eq("order_id", orderId)
      .maybeSingle();

    if (row?.firebase_uid) {
      boundUid = String(row.firebase_uid);
      boundProduct = String(row.product_id);
      boundAmount = Number(row.amount_paise) || 0;
    } else {
      // Fallback: Razorpay order notes
      const orderResp = await rzpFetch(`/orders/${orderId}`, KEY_ID, KEY_SECRET);
      if (!orderResp.ok) {
        return clientError(req, {
          status: 502,
          code: "order_resolve_failed",
          message: "Could not verify this payment.",
        });
      }
      const order = await orderResp.json();
      boundUid = String(order?.notes?.firebase_uid || "");
      boundProduct = String(order?.notes?.product_id || "");
      boundAmount = Number(order.amount) || 0;
    }

    if (!boundUid || boundUid !== uid) {
      return clientError(req, {
        status: 403,
        code: "order_user_mismatch",
        message: "This order does not belong to your account.",
      });
    }
    if (boundProduct && boundProduct !== productId) {
      return clientError(req, {
        status: 400,
        code: "product_mismatch",
        message: "Product mismatch.",
      });
    }
    const expectedAmount = Math.round(pkg.priceInr * 100);
    if (boundAmount && boundAmount !== expectedAmount) {
      return clientError(req, {
        status: 400,
        code: "amount_mismatch",
        message: "Payment amount does not match package.",
      });
    }

    // Idempotent credit ledger
    const { data: existing } = await admin
      .from("nofap_coin_purchases")
      .select("payment_id, coins_granted, firebase_uid")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (existing?.payment_id) {
      if (String(existing.firebase_uid) !== uid) {
        return clientError(req, {
          status: 409,
          code: "payment_conflict",
          message: "This payment is already linked to another account.",
        });
      }
      return json(req, {
        ok: true,
        alreadyCredited: true,
        coinsGranted: existing.coins_granted ?? pkg.coins,
        productId,
        paymentId,
      });
    }

    const { error: insErr } = await admin.from("nofap_coin_purchases").insert({
      payment_id: paymentId,
      order_id: orderId,
      firebase_uid: uid,
      product_id: productId,
      coins_granted: pkg.coins,
      amount_paise: expectedAmount,
    });

    if (insErr) {
      // Unique race — re-read
      if (/duplicate|unique/i.test(insErr.message || "")) {
        return json(req, {
          ok: true,
          alreadyCredited: true,
          coinsGranted: pkg.coins,
          productId,
          paymentId,
        });
      }
      return clientError(req, {
        status: 500,
        code: "ledger_write_failed",
        message: "Payment verified but ledger write failed. Contact support.",
        log: insErr.message,
      });
    }

    await admin
      .from("nofap_razorpay_orders")
      .update({ status: "paid" })
      .eq("order_id", orderId);

    // Client applies coins to Firebase profile (same trust model as free XP offline).
    // Payment cannot be forged without a valid Razorpay signature.
    return json(req, {
      ok: true,
      alreadyCredited: false,
      coinsGranted: pkg.coins,
      productId,
      paymentId,
    });
  }

  return clientError(req, {
    status: 400,
    code: "unknown_action",
    message: "Unknown action.",
  });
});
