# FINAL TEST RESULTS — Lumixo

**Date:** 2026-07-12  
**Validation log:** `validation/results/validation-2026-07-12T18-05-54-900Z.txt`

---

## Automated summary

| Layer | Result |
|-------|--------|
| typecheck-mobile | **PASS** |
| typecheck-web | **PASS** |
| jest-mobile | **PASS** (13 suites / **80** tests) |
| offline-test | **PASS** |
| call-test | **PASS** |
| theme-contrast | **PASS** (light + AMOLED) |
| notification-validation-matrix | **PASS** contracts |
| web production build | **PASS** (`vite build`) |
| Supabase migrations 0049, 0050 | **Applied** to linked project |
| Edge functions push, payments-razorpay | **Deployed** |

---

## Jest suites (mobile)

- authLinks, clearChatLogic, emojiSearch, lumixoCat  
- notificationSetup, paymentPlan, premiumLock  
- safeLayout, safeUrlLogic, syncReflushLogic, time  
- mediaViewerMath, qualityEstimate  

**New this challenge:** `safeUrlLogic.test.ts`, `syncReflushLogic.test.ts`

---

## Not run (environment)

| Test | Reason |
|------|--------|
| Full Android instrumentation | No device farm in session |
| iOS simulator CallKit | Expo limits + no Mac CI device run here |
| Live 2-device FCM latency | Requires physical pair |
| Pen-test / fuzz | Out of automated suite |
| DB authz script | Needs `DATABASE_URL` / password (skipped in suite) |

---

## Manual P0 remaining

See `validation/PRODUCTION_VALIDATION_SUITE.md` and Play Store gate checklist. Especially:

- Force-stop FCM delivery  
- Call ring while killed + hangup cancel-by-tag  
- Doze 30+ min  
- Multi-device tray clear  

---

## Regression confidence

**High** for unit/contract layers covered by suite.  
**Medium** for end-to-end OEM notification and call NAT traversal without TURN lab results.
