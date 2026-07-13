# Play Store GO / NO-GO Gate

**App version:** ________  
**APK/AAB hash or path:** ________  
**Date:** ________  
**Engineer:** ________  
**QA:** ________  

---

## A. Automated (must be green)

| Check | Result |
|-------|--------|
| `node scripts/run-validation-suite.mjs` exit 0 | ☐ Pass ☐ Fail |
| Mobile TypeScript clean | ☐ Pass ☐ Fail |
| Jest unit tests clean | ☐ Pass ☐ Fail |
| Offline suite clean | ☐ Pass ☐ Fail |
| Call-test suite clean | ☐ Pass ☐ Fail |

---

## B. Critical manual P0 (must be green)

| ID | Case | Device | Pass |
|----|------|--------|------|
| AUTH-001/002 | Sign up / sign in / session restore | | ☐ |
| AUTH-004 | Password reset | | ☐ |
| AUTH-005 | Sign out clears push identity | | ☐ |
| MSG-001/002 | Send text / no double send | | ☐ |
| MSG-007 | Reactions | | ☐ |
| GRP-001/002 | Create group / admin-only send | | ☐ |
| CALL-001 | Same-network call | | ☐ |
| CALL-002 | Cross-network + TURN | | ☐ |
| CALL-005 | Accept from notification | | ☐ |
| CALL-006 | Single call notification | | ☐ |
| NOTIF-002 | Killed-state push | | ☐ |
| MED-001/002/003 | Photo / video type / viewer audio | | ☐ |
| VO-001/002 | View once + offline fail-closed | | ☐ |
| FILE-001/002 | Document online + offline | | ☐ |
| OFF-001/002/004 | Offline cache + outbox + draft | | ☐ |
| PAY-002/004 | Payment amount binding + no free grant | | ☐ |
| SEC-001/003 | No secrets in APK / auth redirects | | ☐ |
| PERF-001/003 | List scroll / long-press menu | | ☐ |
| REG-001/002 | Fresh install + upgrade install | | ☐ |

---

## C. Ops / infrastructure (must be confirmed)

| Item | Status |
|------|--------|
| FCM / `push` edge deployed | ☐ |
| Push outbox drain cron scheduled | ☐ |
| Account-purge cron scheduled | ☐ |
| TURN live (`EXPO_PUBLIC_TURN_*`) | ☐ |
| Migrations 0031, 0042–0047 applied | ☐ |
| Release keystore backed up offline | ☐ |
| Play Data safety / privacy policy URLs live | ☐ |
| Crash report path working (optional) | ☐ |

---

## D. Decision

| Option | Criteria |
|--------|----------|
| **GO — Internal / Closed beta** | A green + AUTH/MSG/OFF P0 green |
| **GO — Open testing (staged %)** | A green + all section B green + ops C green except optional |
| **GO — 100% production** | All above + CALL-002 green + 48h open-test soak + no Sev-1 |
| **NO-GO** | Any P0 Fail or secrets leak or payments self-grant |

**Decision:** ☐ GO Internal ☐ GO Open ☐ GO 100% ☐ NO-GO  

**Blockers:**  
_______________________________________________  

**Signatures:**  

Eng _________________ date ______  

QA _________________ date ______  
