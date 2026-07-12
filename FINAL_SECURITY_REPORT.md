# FINAL SECURITY REPORT — Lumixo

**Date:** 2026-07-12  
**Migrations applied to linked project:** `0049_security_lockdown`, `0050_profile_privacy`  
**Edge deploys:** `payments-razorpay`, `push`

---

## Score: Security **8.6 / 10**

Not 10/10: client-side App Lock is not SE/TEE-bound; PIN remains offline-bruteforceable with enough resources after extraction; E2E content encryption is transport-level (TLS + WebRTC DTLS/SRTP), not Signal-protocol message E2EE.

---

## Threat model (summary)

| Asset | Threat | Control |
|-------|--------|---------|
| Subscriptions | Free premium / replay | Service-role activate only; Razorpay HMAC + order bind + payment id idempotency |
| Messages | Impersonation / system forgery | RLS; block client system insert; freeze type/sender/conversation on UPDATE |
| Push | Spam / suppress / token steal | Outbox claim service_role; token reassignment denied |
| Profiles | Phone / ban field harvest | RLS own/admin; public_profiles for discovery; no `select *` in getProfile |
| Web session | App lock bypass | Bound WebAuthn + PBKDF2 PIN |
| Media links | XSS via `javascript:` | `safeHref` + signed URL path hardening |
| Auth | Stolen JWT | Supabase session; App Lock adds device gate (not server auth) |

---

## P0 fixes verified

### 1. `admin_activate_subscription`
- **Was:** Callable / inverted gate risk for free premium.  
- **Now:** `auth.role() = service_role` (or postgres); EXECUTE revoked from `anon`/`authenticated`.  
- **Idempotency:** Same `provider_subscription_id` active → no-op; bound to other user → exception.

### 2. Payments (`payments-razorpay`)
- HMAC(`order_id|payment_id`)  
- Payment.order_id must match  
- Order `notes.user_id` must match JWT user  
- Amount must match order and plan ladder (2500 / 24900 paise)  
- Activate via service role only  

### 3. System messages
- Membership check in `post_system_message`  
- Client EXECUTE revoked  
- `guard_message_update` freezes type / sender / conversation  

### 4. Push pipeline
- `claim_push_*`, `enqueue_push`, `recipient_push_tokens` → service_role  
- Client `sendPush` no longer requests global drain (`drainOutbox: false`)  

### 5. FCM tokens
- `register_push_token` does not steal another user’s token  

### 6. Profiles (0050)
- Dropped world-readable full profiles  
- `public_profiles` with `security_invoker = false` for safe discovery  
- `getProfile` uses public columns only  

### 7. Web App Lock
- Biometrics via `deviceAuth` (stored credential + `allowCredentials`)  
- PIN: PBKDF2-SHA-256, 210k iterations, random salt, min 6 digits  
- Legacy SHA-256 hashes upgraded on successful unlock  

### 8. XSS
- GroupInfo media/docs, ContactProfile thumbs/docs, useSignedUrl non-media paths  

---

## Residual risks (honest)

| Risk | Severity | Why not fully closed |
|------|----------|----------------------|
| XSS elsewhere (e.g. CSS `url()` edge cases) | P2 | Continuous review; React text nodes help |
| App Lock PIN offline brute-force after device compromise | P2 | Client crypto ceiling; need Secure Enclave / Keystore PIN |
| No message-content E2EE | Product | Would need Signal/MLS protocol — not in stack |
| AI function cost abuse | P2 | Premium gate only; needs rate limit table |
| Admin JWT compromise | Inherent | service_role must stay server-only |
| Supabase RLS footguns on new tables | Process | Require migration review checklist |

---

## Recommendations (ops)

1. Rotate any historical secrets if admin RPC was ever client-exposed in prod.  
2. Enable Supabase leaked password protection + MFA for admins.  
3. Monitor `admin_activate_subscription` and payment 409s.  
4. Schedule AI rate-limit migration.  
5. Pen-test notification reply + call accept cold start on real devices.

---

## Evidence

- Migrations present under `supabase/migrations/0049_*.sql`, `0050_*.sql`  
- Linked `supabase db push` succeeded for both  
- Functions deployed to project `toscljrivrawvlfebdzz`
