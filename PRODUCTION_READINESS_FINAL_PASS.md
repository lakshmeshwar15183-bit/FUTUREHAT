# Lumixo — Final Engineering Pass (Production Readiness)

**Date:** 2026-07-12  
**Version:** 4.6.0 (versionCode 60)  
**Branch:** `parity/web-mobile-2026-07`  
**Scope:** Fix-only (no new features). Security, data integrity, races, battery, crash paths.

---

## 1. Every issue fixed (this pass)

| # | Severity | Issue | Fix |
|---|----------|--------|-----|
| 1 | **P0 Security** | Razorpay `body.plan` could grant yearly after monthly payment | Plan derived **only** from captured amount (2500 / 24900 paise). Deployed edge `payments-razorpay`. |
| 2 | **P0 Data loss** | Outbox RMW race dropped queued messages | Serialized `withOutboxLock` on enqueue/remove/update |
| 3 | **P0 Data loss** | Action queue same RMW race | Serialized `withActionLock` |
| 4 | **P0 Messaging** | Double-tap text send (no re-entrancy) | `sendInFlight` ref on `handleSend` |
| 5 | **P1 Push** | FCM before message insert (ghost notif) | Removed client `sendPush` pre-insert; push only after outbox flush |
| 6 | **P1 Media** | Camera/mic/docs lost offline (no outbox) | `sendMedia` → durable outbox + `localUri` (same as gallery path) |
| 7 | **P1 View Once** | Opened media when server consume failed | Fail-closed: alert on null response |
| 8 | **P1 Calls** | Double incoming-call tray (CallContext + Bridge) | CallContext notifies only when app **active** |
| 9 | **P1 Calls** | Ring timeout after unmount/sign-out | Clear `ringTimeoutRef` on channel cleanup |
| 10 | **P1 Race** | Draft restored into wrong chat after switch | `alive` flag on draft effect |
| 11 | **P1 Race** | Disappearing timer header stale chat | `alive` flag |
| 12 | **P1 Race** | Reactions/presence setState after unmount | `alive` guard on reactions + presence + typing clear |
| 13 | **P2 Battery** | 60s scheduled-dispatch while backgrounded | Interval only when `AppState === 'active'` |
| 14 | **P2 Crash** | Search rejections unhandled | try/catch on message + profile search |
| 15 | **P2 Memory** | Audio status setState after unmount | `mountedRef` in AudioMessage |
| 16 | **Prior** | Dialog/UI polish, emoji system, list perf, motion tokens | Already on branch |

---

## 2. Remaining limitations (honest)

| Area | Limitation |
|------|------------|
| **Calls** | No native CallStyle / PushKit; cross-network needs TURN configured |
| **Push** | Client can still craft title/body for group spam (membership checked; content not bound to message row) |
| **Web** | Still uses `window.confirm` for some destructive actions |
| **Admin/Stories** | Not fully on global motion/listPerf tokens |
| **Video** | Trim/mute are metadata-only without native transcoder |
| **Scale** | Single Supabase region; no multi-region; Realtime fan-out limits apply |
| **Observability** | Lightweight `crash-report` edge — not full Sentry/APM |
| **Billing** | Play Billing not wired; Razorpay is primary (web); mobile premium UI may still gate features |
| **Ops** | Push drain + account-purge crons must be scheduled in production |

---

## 3–7. Scores

| Score | Value | Notes |
|-------|------:|-------|
| **3. Production readiness** | **84 / 100** | Core messaging + payments harden ready for closed/open beta; ops + TURN still required for full GA |
| **4. Stability** | **86 / 100** | Outbox locks, send re-entrancy, unmount races fixed; device matrix not fully re-run this pass |
| **5. Performance** | **82 / 100** | List windowing + scroll setState fix + battery interval pause; mid-tier FPS not instrumented here |
| **6. Security** | **88 / 100** | Payment amount binding closed major hole; RLS + subscription lock + no free client grant; push content binding still open |
| **7. Scalability** | **72 / 100** | Fine for early growth; 1M+ needs connection pooling review, Realtime strategy, CDN/media, possibly queue workers |

---

## 8. Estimated readiness by user scale

| Scale | Readiness | Notes |
|-------|-----------|--------|
| **10K** | **Ready** | Current architecture sufficient with TURN + FCM + crons |
| **100K** | **Mostly ready** | Monitor Supabase Realtime, storage, DB indexes; may need connection pooler tuning |
| **1M** | **Needs work** | Media pipeline, rate limits, shard/read replicas, dedicated push workers, on-call |
| **10M** | **Not ready** | Multi-region, call SFU, heavy caching, dedicated infra — redesign required |

---

## 9. GO / NO-GO — Play Store release

### **CONDITIONAL GO** (open beta / staged rollout)

**GO for:**

- Internal testing / closed beta  
- Open testing with staged % rollout  
- Soft launch markets  

**Block full 100% production GA until:**

1. TURN configured and verified on cellular ↔ Wi‑Fi calls  
2. FCM drain cron + account-purge cron live  
3. Device QA matrix (low-RAM Android, Doze, notification accept/decline, offline send)  
4. Play Console privacy / data safety / keystore backup confirmed  

**NO-GO reasons for immediate 100% GA:** incomplete device QA in this session, call quality depends on env TURN, remaining push content-binding abuse surface (low severity if rate-limited).

---

## Regression checklist (manual)

- [ ] Sign in / out / password reset  
- [ ] Send text (double-tap does not duplicate)  
- [ ] Offline text + media → reconnect flushes  
- [ ] Camera / voice note while offline → survives  
- [ ] View Once fail when offline  
- [ ] Incoming call single notification  
- [ ] Accept call from notification starts media  
- [ ] Group send as non-admin blocked  
- [ ] Premium purchase path (Razorpay amount binding)  
- [ ] Chat list scroll 60fps feel  
- [ ] Long-press menu open  
- [ ] Emoji composer multi-insert  
- [ ] App background does not keep scheduled-dispatch interval  

---

## Artifacts

- Report: this file  
- Payments: deployed `payments-razorpay`  
- App: **Lumixo v4.6.0** (see `release/` after build)  

---

*This pass deliberately did not add features. It closed production-blocking integrity and security gaps identified by full-code audit.*
