# SECURITY_AUDIT — Lumixo (Final Hardening Pass)

**Date:** 2026-07-13  
**Scope:** Mobile Android, Web, Supabase RLS/RPCs, Edge Functions, Razorpay  
**Principle:** Do not claim unhackable. Score residual risk honestly.

---

## Executive score: **8.7 / 10**

| Domain | Score | Notes |
|--------|------:|-------|
| Auth / sessions | 8.5 | Supabase JWT + force-logout pulse; no custom auth crypto |
| Authorization / RLS | 9.0 | Mature policy set through 0051–0057 |
| Payments | 9.2 | Service-role activate only; HMAC + amount bind + idempotency |
| API / Edge | 8.8 | CORS allowlist, generic client errors, rate limits on AI |
| Client secrets | 9.5 | Anon key only (public-by-design); no service_role in app |
| App Lock / privacy | 7.5 | Client-side PIN/biometric ceiling; not E2EE |
| Release logging | 9.0 | `prodLog` + crash reporter; hardened this pass |

---

## Controls verified (no redesign)

### Authentication
- Email/password via Supabase Auth; session persistence on device SecureStore / web storage.
- Force-logout: `decideForceLogout` avoids bouncing fresh logins (session issue time vs pulse).
- Password reset deep link health-checked at startup (`prodHealth`).

### Authorization
- Premium activation: `admin_activate_subscription` **service_role only** (client path fail-closed).
- System messages: client insert blocked; UPDATE freezes type/sender/conversation.
- Admin probes: `is_admin` / owner allowlist; moderator separate from owner.
- Push claim/enqueue/token read: service_role; client `sendPush` does not drain global outbox.

### Payments (Razorpay)
- KEY_SECRET / webhook secret: Edge secrets only.
- Verify: HMAC(`order_id|payment_id`), order notes user bind, amount ladder (2500/24900 paise).
- Webhook: signature + stable event id (no `Date.now()` idempotency).
- Duplicate payment → no-op or forbidden cross-user (shared `razorpayLogic` tests).

### Database
- RLS enabled across messaging / groups / communities / payments tables (61+ enable statements in migrations).
- Profile privacy: `public_profiles` for discovery; phone not world-readable.
- Subscriptions: own-row SELECT (0057); badges via `premium_users` view.

### App
- `allowBackup=false` (prior audit); cleartext traffic disabled.
- Release builds: verbose logs gated on `__DEV__`.
- Root `ErrorBoundary` + global JS / unhandled rejection capture (`crashReporter`).
- Crash payloads: truncated message/stack; optional Edge `crash-report`.

---

## Fixes in this hardening pass

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| H-SEC-01 | **High** | Poll `UPDATE` policy (0062) allowed creator to change `conversation_id` / content (IDOR-ish move) | Migration **0063** `guard_poll_update` freezes id/conversation/creator/content; blocks reopen |
| H-SEC-02 | Medium | Release logcat dumps (ErrorBoundary full stack, GroupInfo, mediaCache, FCM handler) | Route through `prodLog` / `__DEV__` only; swallow notification handler errors |

**Apply on production:** `0062_group_poll_polish.sql` (if not applied) + **`0063_poll_update_guard.sql`**.

---

## Residual risks (not fully closable in this codebase)

| Risk | Severity | Why residual |
|------|----------|--------------|
| No Signal/MLS message E2EE | Product | TLS + RLS only for chat content at rest |
| App Lock PIN offline brute after extract | P2 | Client KDF ceiling; needs hardware keystore-bound PIN |
| OEM kill of FCM / full-screen calls | Ops | Device matrix validation |
| Compromised user JWT | Inherent | Supabase session model |
| Physical device + rooted debug | Inherent | Play Integrity recommended ops follow-up |
| TURN credentials in `EXPO_PUBLIC_*` | Accepted | Common for client ICE; rotate + restrict |

---

## Explicit non-findings

- No `service_role` key in mobile/web client source.
- No Razorpay secret in client; config returns `keyId` only.
- `*.keystore` gitignored (local keystore must stay off VCS backups only).
- Release gates script passes push-drain ACL + TURN production hard-require contracts.

---

## Recommendation

**Security is sufficient for public beta** after applying migration **0063** on the live project and confirming Edge secrets (`RAZORPAY_*`, `CRON_SECRET` / push secrets) are set in the host environment—not only in docs.
