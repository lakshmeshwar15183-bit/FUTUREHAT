# CRASH_ANALYSIS — Lumixo (Final Hardening Pass)

**Date:** 2026-07-13

---

## Crash capture stack

| Layer | Mechanism |
|-------|-----------|
| React render | Root `ErrorBoundary` (`App`) + ChatScreen boundary |
| JS fatal / non-fatal | `ErrorUtils.setGlobalHandler` via `installCrashReporter` |
| Unhandled promises | `promise/setimmediate/rejection-tracking` |
| Persistence | AsyncStorage last crash + breadcrumbs (`prodLog`) |
| Remote | Optional Edge `crash-report` (truncated payload) |

---

## Design goals (status)

| Goal | Status |
|------|--------|
| Never blank white screen on render throw | ✅ Fallback + Try again |
| Never lose messages due to UI crash | ✅ Local cache / outbox independent of screen |
| Network failure | ✅ Catch + queue / Alert; no throw to root |
| Permission denial | ✅ Alert / settings deep-link patterns |
| Malformed server rows | ✅ Optional chaining / filters; partial residual |
| Storage full | ✅ Best-effort; outbox write drops oldest web items |

---

## This pass — crash-adjacent fixes

1. **ErrorBoundary** — no full stack dump to logcat in release (`logError` only).
2. **NotificationsBridge** message handler — catch-all empty (no crash on bad payload).
3. **notifications response** — `.catch(() => {})` instead of `console.error`.
4. **GroupInfo load** — failed load keeps last state; soft log.
5. **Call create/accept** — user-visible failure only; DEV logs only.
6. **mediaCache download** — null return + soft log; no throw.

---

## Known non-crash residual issues

| Issue | Severity | Notes |
|-------|----------|-------|
| Dead-lettered outbox messages | UX | Surfaced as failed send, not crash |
| OEM process kill mid-call | Platform | Reconnect best-effort |
| Hermes OOM on huge media | Edge | Monitor field |

---

## Validation expectations (QA)

Force-test: offline send, deny mic, deny camera, open corrupt media URI, airplane during call, kill app during upload, rotate during video.

**Crash resistance: production-ready for beta** with continued field Crashlytics/Sentry optional upgrade later.
