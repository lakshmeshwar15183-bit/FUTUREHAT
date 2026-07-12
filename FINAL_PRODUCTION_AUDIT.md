# FINAL PRODUCTION AUDIT — Lumixo

**Date:** 2026-07-12  
**Branch:** `parity/web-mobile-2026-07`  
**Role lens:** CTO / Principal multi-stack engineering  
**Method:** Multi-pass audit → fix → verify → re-audit until remaining issues are platform-limited or product-scope, not leftover code defects we can still close in-repo.

---

## Executive summary

Lumixo is a **production-capable** messaging stack (Expo RN mobile + Vite web + Supabase) that has been hardened through continuous security, reliability, call, notification, and offline-sync passes. Automated validation is **fully green**. Honest production readiness is **high but not WhatsApp-parity 10/10** — residual limits are Expo/FCM/OEM/WebRTC/TURN/browser and a few product-parity gaps (web durable outbox, hardware call matrix).

---

## Engineering passes executed

| Pass | Focus | Outcome |
|------|--------|---------|
| 1 | Security P0s, races, crashes | Migration 0049/0050 applied; AppLock, payments, XSS, profiles |
| 2 | Notifications, calls, media, offline | Outbox re-flush, ICE glare, notif reply, stickers outbox |
| 3 | Perf, battery, a11y, polish | Cache locks, object URL leaks, call a11y labels |
| 4 | Tests + report suite | 80 Jest tests; full validation suite GREEN |

---

## Dimension scores (honest)

| Dimension | Score | Evidence / ceiling note |
|-----------|------:|-------------------------|
| Production Readiness | **8.4 / 10** | Automated green; device OEM matrix still manual |
| Performance | **8.2 / 10** | Windowed chat, lazy routes, media cache; not native SQLite |
| Security | **8.6 / 10** | 0049/0050 + AppLock PBKDF2 + payment bind; client PIN not hardware-backed |
| Scalability | **7.6 / 10** | Supabase single-region; no multi-region fan-out |
| Offline Reliability | **8.5 / 10** | Mobile outbox + action queue + re-flush; web lacks durable outbox |
| Calls | **7.8 / 10** | ICE restart glare fixed; TURN optional; Expo WebRTC ≠ native WA |
| Notifications | **8.7 / 10** | FCM + outbox + CallStyle path; OEM Doze residual |
| Media | **8.3 / 10** | Signed private bucket, cache lock, View Once |
| Messaging | **8.8 / 10** | Optimistic + outbox + receipts; edit offline still thin |
| Database | **8.5 / 10** | RLS + RPC lockdown; indexes 0035 |
| UX | **8.4 / 10** | Lumi, safe areas, failed-send ticks |
| UI Polish | **8.3 / 10** | Theme contrast suite PASS |
| Battery | **7.9 / 10** | Adaptive call stats 2.5s; push drain no longer client-global |
| Accessibility | **7.7 / 10** | Call controls labeled; not full a11y audit of every screen |
| Code Quality | **8.2 / 10** | Clear modules; some large screens remain |
| Architecture | **8.4 / 10** | Shared API + edge functions; monorepo coherent |

**Weighted production score: ~8.3 / 10**

Never claimed 10/10: see `FINAL_REMAINING_LIMITATIONS.md`.

---

## Bugs found & fixed (this challenge)

### Security
| Issue | Why it existed | Fix |
|-------|----------------|-----|
| Free premium via inverted admin RPC gate | Historical service-role assumption inverted | `0049` service_role only + REVOKE |
| Payment replay / cross-account bind | Verify trusted JWT only | Order notes user_id + paymentId idempotency |
| System message type forgery via UPDATE | RLS allowed type change | `guard_message_update` trigger |
| Push RPC client spam | Grants to authenticated | REVOKE → service_role |
| FCM token hijack on conflict | UPSERT reassigned user_id | Refuse cross-user reassignment |
| Profiles phone enumeration | `using (true)` SELECT * | `0050` + `public_profiles` + safe `getProfile` |
| Web AppLock unbound WebAuthn | Any UV credential unlocked | `deviceAuth` + allowCredentials |
| Weak PIN hash | SHA-256 of short PIN | PBKDF2 210k + salt, min 6 digits |
| GroupInfo / contact `javascript:` href | Raw media_url | `safeHref` everywhere critical |

### Reliability / races
| Issue | Fix |
|-------|-----|
| Outbox flush no re-flush mid-flight | `outboxNeedsReflush` loop |
| Silent dead-letter | Cache `failed` + UI tick + dead-letter listeners |
| WebRTC hangup during gUM | Abort + stop tracks |
| ICE restart glare (both sides) | Caller-only restart + in-flight mutex |
| Offer create race on ready pings | `offerInFlight` mutex |
| Double startCall | `startingRef` + activeRef claim before push |
| Ring hangup missed after 400ms | 2.5s poll while ringing |
| Message cache RMW drop | Per-conversation write chain + merge |
| Media index last-writer-wins | `withIndexLock` merge |
| Notif reply silent success | Only clear tray on confirmed send + messageId |
| Stickers bypass outbox | Enqueue + flush like text |
| Client global push drain abuse | `drainOutbox: false` on sendPush |

---

## Files changed (representative)

- `supabase/migrations/0049_security_lockdown.sql` **applied**
- `supabase/migrations/0050_profile_privacy.sql` **applied**
- `supabase/functions/payments-razorpay/index.ts` **deployed**
- `supabase/functions/push/index.ts` **redeployed**
- `mobile/src/lib/sync.ts`, `localCache.ts`, `mediaCache.ts`
- `mobile/src/calls/webrtc.ts`, `CallContext.tsx`
- `mobile/src/components/NotificationsBridge.tsx`, `MessageBubble.tsx`
- `mobile/src/screens/ChatScreen.tsx`
- `web/src/premium/AppLockGate.tsx`
- `web/src/GroupInfoModal.tsx`, `profile/ContactProfileModal.tsx`
- `web/src/lib/useSignedUrl.ts`
- `shared/api.ts`, `shared/pushApi.ts`

---

## Tests executed

| Layer | Result |
|-------|--------|
| Mobile Jest | **13 suites / 80 tests PASS** |
| Mobile `tsc --noEmit` | PASS |
| Web `tsc` + Vite build | PASS |
| Notification contract matrix | PASS |
| Offline-test + call-test (scripts) | PASS |
| Theme contrast | ALL PAIRINGS PASS |
| Validation suite | **ALL AUTOMATED LAYERS GREEN** |
| Device OEM / kill-app matrix | Manual checklist only |

Log: `validation/results/validation-2026-07-12T18-05-54-900Z.txt`

---

## Remaining issues (fixable vs platform)

See `FINAL_REMAINING_LIMITATIONS.md`. Fixable residual (lower priority): web durable outbox, offline edit queue, action-queue dead-letter toast, AI rate limits, full screen-by-screen a11y.

---

## Production score trajectory

| Milestone | Score |
|-----------|------:|
| Pre-challenge baseline (est.) | ~7.1 |
| After notifications 10/10 push | ~7.8 |
| After this multi-pass challenge | **~8.3** |
| Theoretical with native modules + multi-region + full device QA | ~9.2 |

**Verdict:** Ship-ready for careful production with monitoring, TURN provisioned, and Play Store device QA. Not a claim of WhatsApp feature or reliability parity.
