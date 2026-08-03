# API_AUDIT — Lumixo (Final Hardening Pass)

**Date:** 2026-07-13  
**Surfaces:** Supabase client (PostgREST + RPC), Edge Functions (`push`, `payments-razorpay`, `ai`, `crash-report`, `account-purge`)

---

## Executive score: **8.6 / 10**

---

## Client → Supabase

| Control | Status |
|---------|--------|
| Auth header JWT | Automatic via supabase-js session |
| Input validation | Message length/type server-side; client sanitize search terms |
| IDOR | RLS + membership checks; poll update fixed 0063 |
| Rate limits | Message send; AI writing tools |
| Error leakage | Prefer generic messages on Edge; avoid raw provider dumps |

---

## Edge Functions

### `payments-razorpay`
- Auth required for order/verify/status.
- Secrets server-only.
- CORS origin allowlist.
- Client errors: codes + safe messages; logs truncated server-side.

### `push`
- Drain gated by cron/push secret (release-gates verified).
- Client may enqueue but not freely drain.

### `crash-report`
- Accepts truncated crash payloads; generic errors (prior fix).

### `ai`
- Premium + rate limit + input caps (prior fix).

---

## Threat coverage

| Attack | Mitigation |
|--------|------------|
| SQL injection | Parameterized PostgREST / SQL functions |
| XSS | React text; `safeHref` / signed media |
| CSRF | Bearer JWT APIs; cookie-less primary model |
| IDOR | RLS + DEFINER RPC checks |
| Privilege escalation | Role columns protected; owner single permanent |
| Premium bypass | Server-side activate only |
| Replay payments | HMAC + payment id idempotency |
| Path traversal uploads | Allowlist + extension blocklist |

---

## This pass

- No new public endpoints.
- Poll update surface hardened server-side (0063).

---

## Residual

- Browser XSS surface continuous review.
- Rate limits not on every RPC (expand as abuse appears).
- Play Integrity / app attestation: **ops follow-up**, not wired as hard fail.

**API posture: ready for public beta** with secrets + migration apply confirmed.
