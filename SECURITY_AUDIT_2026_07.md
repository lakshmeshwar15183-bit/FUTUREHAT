# Lumixo Security Audit — July 2026

**Role:** Lead Security Engineer  
**Scope:** Mobile (Android), Supabase (RLS + RPCs), Edge Functions, payments, networking  
**Branch:** `parity/web-mobile-2026-07`

---

## Executive score: **8.9 / 10** (was ~8.6)

Messaging apps cannot be “unhackable.” Residual residual risks (no Signal-protocol E2EE, client App Lock limits, physical device compromise) remain product choices, not oversights.

---

## What was already strong

| Area | Status |
|------|--------|
| **Premium activation** | Client `activateSubscription` fail-closed; only service-role `admin_activate_subscription` |
| **Razorpay** | HMAC verify, order/user/amount bind, webhook signature, idempotent payment ids |
| **System messages** | Client cannot insert/update; DEFINER path only |
| **Message send** | Rate limit 120/min, length cap 16k, type allowlist, sender must be auth.uid() |
| **Push** | Claim/enqueue service_role; token reassignment hardened |
| **Admin probes** | `is_admin(uid)` blocks cross-user probes for non–service-role |
| **Client secrets** | Only `EXPO_PUBLIC_*` / anon key (public-by-design); no service role |
| **App backup** | `allowBackup=false` |
| **Call decline receiver** | `exported=false`, `FLAG_IMMUTABLE` PendingIntents |

---

## Findings fixed in this pass

### P0 — Subscription billing data leakage
**Issue:** Policy `"read premium flags"` allowed authenticated users to `SELECT` **all active** subscription rows (amount, provider payment ids, periods).  
**Fix (0057):** Own-row SELECT only. Badges via `premium_users` view (`user_id` only, `security_invoker=false`).

### P1 — AI cost / abuse
**Issue:** AI edge had premium check but no per-user rate limit; provider errors leaked; unbounded input.  
**Fix:** Action whitelist, text/transcript caps, `check_rate_limit('ai', 20)`, generic errors, no `Authorization: Bearer` API key header misuse.

### P1 — Crash report error leakage
**Issue:** `json({ error: String(e) })` could surface internals.  
**Fix:** Generic `internal error` to clients.

### P2 — Rate limit cleanup RPC
**Issue:** `purge_old_rate_limits` was granted to `authenticated` (DoS on table).  
**Fix:** Revoke from clients; opportunistic purge inside `check_rate_limit`.

### P2 — Cleartext / network policy
**Issue:** No explicit network security config.  
**Fix:** `network_security_config.xml` + `usesCleartextTraffic=false` on application.

### P2 — Release logging
**Issue:** `logWarn`/`logError` always hit console.  
**Fix:** Release path strips verbose logs; errors truncated, no object dumps.

### P2 — Upload extension abuse
**Issue:** Double-extension / script-like names not blocked beyond allowlist.  
**Fix:** Extra blocklist for dangerous suffixes in `assertSafeUpload`.

---

## Residual risks (honest)

| Risk | Severity | Notes |
|------|----------|--------|
| No content E2EE | Product | TLS + WebRTC DTLS/SRTP only |
| App Lock PIN offline brute after root | P2 | Client crypto ceiling |
| Frida / root / emulator “detection” | Theater | Easily bypassed; not a primary control — server authz is |
| Certificate pinning | P2 | Breaks with CDN/MITM corporate proxies; optional later |
| TURN credentials in client env | P2 | Industry-typical; rotate at provider |
| AI feature mostly disabled in UI | — | Edge still hardened if re-enabled |
| Physical device compromise | Inherent | Full disk access defeats App Lock |

**Not implemented as primary security:** aggressive Frida/Xposed/root kill-switches (false positives + bypasses; hurts real users). Abuse is controlled server-side (RLS, rate limits, payment verify).

---

## Ops checklist (human)

1. **Apply migration:** `supabase db push` (includes `0057_security_hardening.sql`).  
2. **Redeploy functions:** `ai`, `crash-report` (and keep `payments-razorpay` current).  
3. Enable Supabase **leaked password protection** + **MFA for admin accounts**.  
4. Confirm **no service_role key** in mobile/web env files.  
5. Production signing: set `FUTUREHAT_UPLOAD_*` so release is not debug-signed.  
6. Monitor payment 409s and `admin_activate_subscription` errors.

---

## Threat model (quick)

```
Client (anon JWT) ──TLS──► Supabase API / Edge
                              │
                              ├─ RLS + auth.uid() ──► data isolation
                              ├─ SECURITY DEFINER RPCs (gated)
                              └─ service_role ONLY on server (payments, push claim)
```

**Attack that must always fail:** free premium without verified payment; reading another user’s messages; forging system call logs; calling admin activate from the app.

---

## Verdict

Lumixo is **production-ready for messaging security** at industry baseline for Supabase-class apps, with this pass closing a real billing-data leak and tightening AI/crash/network surfaces. Apply **0057** and redeploy edge functions before calling the release fully sealed on the linked project.
