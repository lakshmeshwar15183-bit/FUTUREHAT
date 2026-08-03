# Lumixo — Final Production Blocker Report

**Date:** 2026-07-12  
**Pass type:** Fix-only (CRITICAL / HIGH). No general re-audit.  
**Scope:** Mobile + shared + Supabase + web payments security  

---

## Executive verdict

| Question | Answer |
|---|---|
| Ready for **Closed Beta**? | **YES** (after deploy checklist below) |
| Ready for **Open Beta**? | **YES with conditions** (TURN + push cron + migrations applied) |
| Ready for **Public Play Store**? | **NO — not until remaining HIGH items are closed** |
| Ready for **millions of users**? | **NO** (infra scale, TURN fleet, payment ops, monitoring) |
| **Production readiness score** | **7.4 / 10** (was ~6.5 before this pass) |

Remaining **HIGH** items are primarily **ops / infra**, not app-logic crashes. No unfixed **CRITICAL** code issues remain after this pass *if migrations + functions are deployed*.

---

## What was fixed in this pass

### CRITICAL

#### 1. Blocked users could still message each other
| | |
|---|---|
| **Root cause** | `blocked_users` only filtered status views; message INSERT + DM creation did not check blocks |
| **Files** | `supabase/migrations/0044_production_blockers.sql` |
| **Why** | `start_direct_conversation` + `guard_message_insert` had no block logic |
| **Fix** | `users_are_blocked()`; DM create refuses; message insert on direct chats refuses either direction |
| **Regression risk** | Low — groups unaffected; existing DMs still open but send fails with clear error |

#### 2. Premium activation could be spoofed / client-written
| | |
|---|---|
| **Root cause** | Web Razorpay returned `ok:true` on browser handler without HMAC; client called `activateSubscription` upsert; after 0042 upsert fails RLS but design was still unsafe |
| **Files** | `supabase/functions/payments-razorpay/index.ts`, `web/src/payments/razorpay.ts`, `web/src/premium/UpgradeModal.tsx`, `shared/premiumApi.ts` |
| **Why** | Capture-mode checkout trusted client; no order + signature verify |
| **Fix** | Edge Function creates Order, verifies `HMAC(order_id\|payment_id)`, activates via `admin_activate_subscription`; client `activateSubscription` permanently fail-closed |
| **Regression risk** | Medium until `RAZORPAY_KEY_*` secrets + function deploy; until then purchases stay "coming soon" (mobile already `PAYMENTS_READY=false`) |

### HIGH

#### 3. Report / support spam unthrottled server-side
| | |
|---|---|
| **Root cause** | Rate-limit helper existed but triggers only on messages/groups |
| **Files** | `0044_production_blockers.sql` |
| **Fix** | BEFORE INSERT triggers on `reports` and `support_tickets` |

#### 4. Account deletion purge window not reset; no purge worker
| | |
|---|---|
| **Root cause** | Table upsert didn't refresh `purge_after`; no job deleted due accounts |
| **Files** | `0044_…sql` RPCs, `shared/accountApi.ts`, `supabase/functions/account-purge/index.ts` |
| **Fix** | `request_account_deletion` resets 30-day window; Edge Function purges due accounts (cron with service role) |

#### 5. Production call failure logs
| | |
|---|---|
| **Root cause** | Unconditional `console.log` on call start failure |
| **Files** | `mobile/src/calls/CallContext.tsx` |
| **Fix** | Gate with `__DEV__` |

#### 6. Premium unit test contract drift
| | |
|---|---|
| **Files** | `mobile/src/lib/__tests__/premiumLock.test.ts` |
| **Fix** | Assert permanent fail-closed activation |

---

## Remaining CRITICAL issues

**None in application code**, assuming:

1. Migrations **0039–0044** are applied on production Supabase  
2. Edge Functions `push`, `payments-razorpay`, `account-purge` are deployed  
3. Secrets set: `FCM_SERVICE_ACCOUNT`, and (when enabling paid) `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`

If migrations are **not** applied on live DB, treat **block enforcement** and **subscription lock** as still CRITICAL in production.

---

## Remaining HIGH issues (must close before public launch)

| # | Issue | ETA | Owner |
|---|---|---|---|
| H1 | **TURN credentials** for reliable cellular/NAT calls (`EXPO_PUBLIC_TURN_*`) | 0.5–1 day | DevOps |
| H2 | **Push outbox cron** every 60s (service role → `push` drain) when no clients online | 1–2 hours | DevOps |
| H3 | **Account purge cron** daily → `account-purge` | 1 hour | DevOps |
| H4 | **Deploy 0043+0044** + redeploy edge functions on production | 1–2 hours | DevOps |
| H5 | **Play Store assets** (screenshots, data safety form, test account, privacy URL live) | 1–2 days | Product |
| H6 | **Mobile IAP / Play Billing** for Lumixo+ (currently purchases off on mobile) | 3–5 days | Mobile |
| H7 | **Call full-screen / CallStyle / ConnectionService** (not WhatsApp-dialer class yet) | 1–2 weeks | Mobile native |
| H8 | **Remote crash pipeline** (`EXPO_PUBLIC_CRASH_WEBHOOK_URL` or Sentry) | 0.5 day | DevOps |
| H9 | **Load / soak test** (10k concurrent realtime, push volume) | 2–3 days | QA + Backend |

Items **H1–H5 + H8** are launch-blocking for public Play Store.  
**H6** is OK for free launch (premium “coming soon”).  
**H7** is quality gap for calls, not a crash blocker.  
**H9** is required before “millions of users”.

---

## Remaining MEDIUM / LOW (do not block closed beta)

| Severity | Item |
|---|---|
| MEDIUM | iOS PushKit VoIP for killed-state call wake |
| MEDIUM | Notification Service Extension for avatar reliability on iOS |
| MEDIUM | E2E encrypted message content in FCM payload |
| MEDIUM | Android 15 visual pass (edge-to-edge) on physical devices |
| MEDIUM | Server-side media magic-byte validation / malware scan |
| LOW | Console.warn in edge functions (acceptable ops logs) |
| LOW | ManualProvider remains as fail-closed stub |
| LOW | New Architecture still off (intentional for WebRTC) |

---

## Deploy checklist (must run before beta)

```bash
# DB
supabase db push   # includes 0043 push hardening + 0044 blockers

# Functions
supabase functions deploy push
supabase functions deploy payments-razorpay
supabase functions deploy account-purge

# Secrets (as needed)
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
supabase secrets set RAZORPAY_KEY_ID=...
supabase secrets set RAZORPAY_KEY_SECRET=...

# Crons (Supabase Dashboard or external)
# every 1 min:  POST /functions/v1/push  { "drainOutbox": true, "limit": 100 }
# every 1 day:  POST /functions/v1/account-purge { "limit": 50 }
# Auth: Authorization: Bearer <SERVICE_ROLE_KEY>
```

Mobile rebuild after notification channel v5 + any native permission changes.

---

## Feature reliability (this pass)

| Feature | Status |
|---|---|
| Auth / password reset / deep links | Production-capable (verify App Links on device) |
| Chats / groups / media / offline outbox | Production-capable |
| Blocks | **Fixed** server-side |
| Notifications | Production-capable with FCM + cron |
| Calls | Works with TURN; without TURN = cellular failures (HIGH ops) |
| Premium mobile | Intentionally disabled until Play Billing |
| Premium web | Secure path ready after Razorpay secrets + function deploy |
| Account deletion request | Fixed window; purge needs cron |
| Admin / moderation / RLS | Solid if migrations applied |
| Crash reporting | Local + optional webhook |

---

## Performance (code-level)

Prior pass fixed long-press sheet cold-start. Remaining FPS risks are device/network bound (media decode, WebRTC). No new polling loops introduced; push drain interval polling removed earlier.

Targets remain: **60 FPS UI**, **120 FPS** on capable devices for pure JS animations.

---

## Security summary

| Control | Status |
|---|---|
| RLS on core tables | ✅ |
| Media storage membership-scoped | ✅ (0039) |
| Subscription free-grant closed | ✅ (0042 + client fail-closed) |
| Block enforcement | ✅ (0044) |
| Rate limits messages/reports/tickets | ✅ |
| Payment HMAC verify | ✅ (edge) |
| Secrets not in client | ✅ |
| Service role only on server | ✅ |
| Account purge worker | ✅ code; ⏳ cron ops |

---

## Scores by domain

| Domain | Score |
|---|---|
| Messaging core | 8.5 |
| Security / RLS | 8.5 |
| Notifications | 8.0 |
| Payments | 7.5 (web path; mobile off) |
| Calls | 6.5 (needs TURN + native call UI) |
| Ops / observability | 6.5 |
| Scale readiness | 5.5 |
| **Overall** | **7.4 / 10** |

---

## Go / No-go matrix

| Gate | Decision |
|---|---|
| Closed Beta (friends / internal) | **GO** after H4 deploy |
| Open Beta (public testers) | **GO** after H1–H5 + H8 |
| Public Play Store launch | **NO-GO** until Open Beta criteria + store listing + 48h soak |
| Millions of users | **NO-GO** until H9 + multi-region TURN + monitoring + cost controls |

---

## Manual work you must do (cannot be finished in-repo alone)

1. Apply migrations on production Supabase  
2. Deploy three Edge Functions + set secrets  
3. Schedule push + account-purge crons  
4. Provision TURN (Twilio / coturn / Cloudflare Calls)  
5. Play Console: listing, data safety, test account, content rating  
6. Device matrix: Android 10–15 kill-state push, call on LTE, password reset App Link  
7. Optional: enable web Razorpay with live keys only after function deploy verified  

---

## Bottom line

This pass closed the **real code CRITICALS** (block bypass, payment self-grant design hole) and several **HIGH** reliability/security gaps (rate limits, deletion purge worker, activation fail-closed, log leak).

**Lumixo is Closed-Beta ready after deploy.**  
**It is not yet public-Play-Store-ready** until ops items H1–H5 and H8 are done.  
**It is not millions-scale ready** without TURN fleet, soak tests, and monitoring.

Do **not** mark “production-ready for public launch” until remaining HIGH ops items are green.
