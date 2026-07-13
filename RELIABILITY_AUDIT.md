# RELIABILITY_AUDIT — Lumixo (Final Hardening Pass)

**Date:** 2026-07-13  
**Scope:** Offline messaging, media, calls, notifications, DB, network recovery

---

## Executive score: **8.4 / 10** (mobile higher than web)

| Area | Mobile | Web | Notes |
|------|-------:|----:|-------|
| Message outbox | 9.0 | 8.0 | Both durable; mobile action queue richer |
| Connectivity recovery | 9.0 | 8.5 | NetInfo / online events + re-flush |
| Media upload/download | 8.5 | 8.0 | Retry/cache; full pause/resume incomplete |
| Calls | 8.0 | 7.5 | Needs managed TURN; ICE recovery present |
| Notifications | 8.5 | 7.0 | Android channels + battery assist; OEM variance |
| Crash resistance | 9.0 | 8.0 | Boundaries + global handlers |

---

## Network recovery

| Scenario | Behavior |
|----------|----------|
| Wi-Fi ↔ cellular | NetInfo drives `online`; outbox flush on reconnect |
| Airplane / offline | Optimistic UI + durable queue; dead-letter after max attempts |
| Mid-flush disconnect | Re-flush flag; stop early when offline |
| High latency | Retries with attempt counters; UI pending ticks |

**Invariant:** Flush is re-entrancy-guarded (`flushing` + `outboxNeedsReflush`) so enqueue during flush is not lost.

---

## Message reliability

| Guarantee | Status |
|-----------|--------|
| No silent permanent loss without signal | Dead-letter listeners + failed cache state (mobile) |
| Deduped client ids | Client UUID used as message id for realtime merge |
| Order | Per-conversation chronological; outbox oldest-first |
| ACKs | Delivered/read receipts with tick map |
| Offline queue | Mobile `localCache` outbox; web `localStorage` + IndexedDB blobs |
| Conflict | Last-write for edits; server is authority on confirm |

**Gaps (honest):**
- Multi-device concurrent edits: last writer wins (acceptable for beta).
- Action-queue max attempts can drop non-message actions with limited UX (P2).

---

## Media reliability

- Upload path: typed allowlist + safe extension checks (prior hardening).
- Download: cache index, inflight map, failure → null (no throw to UI).
- View Once / signed URLs: privacy-sensitive paths use signed access patterns.

**Gaps:** True pause/resume for multi-GB uploads not first-class (large files best-effort retry).

---

## Call reliability

- ICE restart / glare handling in prior call production work.
- Production **blocks** start without TURN (`release-gates` enforces).
- Accept/start failures: user Alert, no uncaught crash; logs DEV-only after this pass.
- Audio route / BT: OS-level; app links to system settings for permissions.

**Gaps:** Group SFU, full CallKit/Telecom, OEM full-screen intent variance.

---

## Notification reliability

- Channels for messages/groups/calls/mentions/communities.
- Battery optimization assistant for OEMs.
- FCM response handler: errors swallowed (no crash).
- Push outbox drain: cron secret only (no user JWT global drain).

**Gaps:** OEM battery kill cannot be fully software-fixed.

---

## Database reliability

- Migrations additive; FK cascades on conversations/messages.
- Indexes for performance (0035+).
- Poll close: 0062 + **0063 guard** against reopen / reassignment races.
- Rate limits on message send / AI (prior migrations).

---

## This pass

- Notification / call / media error paths: no release console dumps, no crash on handler failure.
- Poll close cannot reopen or move conversation (0063).

---

## Verdict contribution

Mobile messaging offline path is **production-grade for beta**. Web offline is **good enough for beta** with known lag behind mobile. Calls require **managed TURN in prod env** (gate enforced).
