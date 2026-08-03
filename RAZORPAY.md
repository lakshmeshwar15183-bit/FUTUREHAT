# Lumixo+ — Razorpay Premium Integration

Production guide for **Monthly (₹25)** and **Yearly (₹249)** Lumixo+ via Razorpay.

> Premium is granted **only** after the `payments-razorpay` Edge Function verifies the payment with Razorpay. Clients never write `subscriptions` and never see `RAZORPAY_KEY_SECRET`.

---

## Architecture

```
Mobile / Web UI
    │  create_order (JWT)
    ▼
Edge Function payments-razorpay
    │  Basic auth → Razorpay Orders API
    │  ledger: razorpay_payments (status=created)
    ▼
Razorpay Checkout (public key_id + order_id only)
    │  payment success → order_id | payment_id | signature
    ▼
Edge Function verify (JWT)
    │  HMAC-SHA256(order_id|payment_id, KEY_SECRET)
    │  GET /payments/{id} (status + amount)
    │  plan from amount only (2500 / 24900 paise)
    │  admin_activate_subscription (service role)
    ▼
subscriptions row active + razorpay_payments captured

Webhook (no user JWT)
    │  HMAC of raw body with RAZORPAY_WEBHOOK_SECRET
    │  payment.captured / order.paid → same fulfill path (idempotent)
    │  payment.failed → ledger failed
    │  refund.* → ledger refunded + revoke if that payment activated premium
```

| Plan | Amount | Paise | Period |
|------|--------|-------|--------|
| Monthly | ₹25 | 2500 | 30 days |
| Yearly | ₹249 | 24900 | 365 days |

Amounts are defined server-side in `payments-razorpay` and must match `shared/premium/plans.ts`.

---

## 1. Database

Apply migrations **`0054_razorpay_payments.sql`** and **`0055_razorpay_payment_hardening.sql`**
(and prior premium locks **0042**, **0049** if not already applied):

```bash
# From repo root, with Supabase CLI linked
supabase db push
# or paste 0054 then 0055 in SQL Editor
```

Audit report: **`PAYMENT_INTEGRATION_REPORT.md`**.

Creates:

- `public.razorpay_payments` — payment records  
  `user_id`, `razorpay_payment_id`, `razorpay_order_id`, `amount`, `currency`, `status`, `created_at`, plus plan / refunds / activation flags  
- `public.razorpay_webhook_events` — webhook idempotency  
- Service-only RPCs for ledger + refund revoke  

Users can **SELECT** their own payment rows. All writes are **service_role** only.

---

## 2. Edge Function secrets (server only)

**Never** put these in `VITE_*`, `EXPO_PUBLIC_*`, mobile binaries, or git.

```bash
# Test mode first
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=your_test_key_secret

# Webhook secret from Razorpay Dashboard → Webhooks (recommended)
supabase secrets set RAZORPAY_WEBHOOK_SECRET=your_webhook_signing_secret

supabase functions deploy payments-razorpay
```

| Secret | Where | Client-visible? |
|--------|--------|-----------------|
| `RAZORPAY_KEY_ID` | Edge secrets | Returned only after auth for Checkout (public key) |
| `RAZORPAY_KEY_SECRET` | Edge secrets only | **Never** |
| `RAZORPAY_WEBHOOK_SECRET` | Edge secrets only | **Never** |

Optional web env (public key fallback only; not required if `config` action works):

```bash
# web/.env.local — KEY ID only, never secret
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
```

Mobile does **not** need a Razorpay env var; it receives `keyId` from `create_order`.

---

## 3. Webhook URL

In [Razorpay Dashboard](https://dashboard.razorpay.com/) → **Account & Settings → Webhooks**:

**URL**

```text
https://<PROJECT_REF>.supabase.co/functions/v1/payments-razorpay
```

**Active events (minimum)**

- `payment.captured`
- `payment.failed`
- `order.paid`
- `refund.created` / `refund.processed` (or `payment.refunded`)

Copy the **Webhook secret** into `RAZORPAY_WEBHOOK_SECRET`.

Supabase may require the `Authorization: Bearer <ANON_or_SERVICE_KEY>` header for function invoke depending on project JWT settings. If the dashboard cannot send custom headers, enable the function to accept webhook POSTs with `x-razorpay-signature` (this function already branches on that header + event payload). If your project enforces JWT on all functions, set the webhook’s custom header to the **anon** key (not the service role) or use Supabase’s documented webhook gateway pattern.

---

## 4. Client flows

### Web

`UpgradeModal` → `refreshPaymentsReady()` → `RazorpayWebProvider.checkout()`  
Uses official Checkout.js + server order/verify.

### Mobile

`PremiumScreen` → `createRazorpayOrder` → `RazorpayCheckoutModal` (Checkout.js in WebView) → `verifyRazorpayPayment`  
Loading, cancel, failure, network errors, and **status retry** after pay are handled in UI.

---

## 5. Test Mode → Live Mode

### Test Mode (default while integrating)

1. Razorpay Dashboard → **Test Mode** (toggle).
2. **API Keys** → copy **Key Id** (`rzp_test_…`) and **Key Secret**.
3. Set Edge secrets (above) with test keys.
4. Deploy `payments-razorpay`.
5. Create a Test Mode webhook pointing at the same function URL; set `RAZORPAY_WEBHOOK_SECRET` from the **test** webhook.
6. Pay with [Razorpay test cards](https://razorpay.com/docs/payments/payments/test-card-details/), e.g.  
   `4111 1111 1111 1111`, any future expiry, any CVV.
7. Confirm:
   - `razorpay_payments.status = 'captured'`
   - `subscriptions.status = 'active'`
   - Premium UI unlocks after verify (not before)

### Go Live

1. Complete Razorpay **KYC / activation** for Live Mode.
2. Dashboard → **Live Mode** → generate **Live** Key Id (`rzp_live_…`) + Key Secret.
3. Rotate secrets (overwrite test values):

   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
   supabase secrets set RAZORPAY_KEY_SECRET=your_live_key_secret
   ```

4. Create a **Live** webhook (same URL, live events) and set:

   ```bash
   supabase secrets set RAZORPAY_WEBHOOK_SECRET=your_live_webhook_secret
   ```

5. Redeploy is optional after secrets change (secrets apply to the next invocation), but redeploy if you changed function code:

   ```bash
   supabase functions deploy payments-razorpay
   ```

6. If you set `VITE_RAZORPAY_KEY_ID`, update it to the **live** key id and rebuild/redeploy web.
7. Run one small real payment, then refund from the dashboard to confirm refund webhook handling.
8. Remove any test keys from CI logs, chat history, and local `.env` files.

**Do not** mix test keys with live webhooks or vice versa.

---

## 6. Security checklist

- [ ] `RAZORPAY_KEY_SECRET` only in Supabase secrets  
- [ ] No secret in `mobile/`, `web/`, or git history  
- [ ] Client `activateSubscription` remains fail-closed (`shared/premiumApi.ts`)  
- [ ] Plan derived from **captured amount**, never from client `plan` alone  
- [ ] Duplicate `razorpay_payment_id` does not re-extend forever (0049 + ledger unique index)  
- [ ] Webhook signature verified before any activation  
- [ ] RLS: users read own payments only  

---

## 7. Failure / retry / refund behaviour

| Case | Behaviour |
|------|-----------|
| User cancels Checkout | No premium; UI shows cancelled |
| Payment failed | Ledger `failed`; no premium |
| Paid but client offline before verify | Webhook and/or `action: status` recovers activation |
| Same payment verified twice | Idempotent no-op |
| Full refund of activating payment | Ledger `refunded`; subscription cancelled for that payment id |
| Network error on create_order | UI error; safe to retry (new order) |

---

## 8. Manual verification commands

```bash
# Deploy function
supabase functions deploy payments-razorpay

# List secrets (names only)
supabase secrets list

# SQL: recent payments
# select user_id, razorpay_order_id, razorpay_payment_id, amount, currency, status, created_at
# from razorpay_payments order by created_at desc limit 20;
```

---

## 9. Related files

| Path | Role |
|------|------|
| `supabase/migrations/0054_razorpay_payments.sql` | Ledger + webhook tables |
| `supabase/functions/payments-razorpay/index.ts` | Orders, verify, webhook |
| `shared/payments/razorpayApi.ts` | Client invoke helpers (no secrets) |
| `shared/premium/plans.ts` | ₹25 / ₹249 |
| `web/src/payments/razorpay.ts` | Web Checkout |
| `mobile/src/payments/RazorpayCheckoutModal.tsx` | Mobile Checkout |
| `mobile/src/screens/PremiumScreen.tsx` | Mobile upgrade UI |

Developed for Lumixo by LAKSHMESHWAR PANDEY.
