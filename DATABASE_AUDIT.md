# DATABASE_AUDIT — Lumixo (Final Hardening Pass)

**Date:** 2026-07-13  
**Migrations:** `0001` … `0063` (+ reactions stamp)

---

## Executive score: **8.8 / 10**

---

## Schema & integrity

| Control | Status |
|---------|--------|
| Primary keys / FKs | Present on core messaging, groups, communities, payments |
| Cascades | Conversation delete cascades participants/messages (by design) |
| Soft delete messages | `is_deleted` + moderation kind |
| Immutable system messages | Triggers freeze type/sender/conversation |
| Disappearing messages | `expires_at` stamped at insert |

---

## RLS

- Enabled on principal tables (messaging, profiles, storage policies historically layered).
- Membership helpers: `is_member`, community helpers, admin DEFINER paths reviewed in 0049–0057.
- Profiles: own/admin; discovery via `public_profiles`.
- Subscriptions: own SELECT; activate service_role only.

**Process risk:** Any new table without RLS is a regression — require checklist on every migration.

---

## Indexes & performance

- Conversation list / messages / participants indexes (0035_performance_indexes + later).
- Push/jobs indexes in push pipeline migrations.
- Recommend EXPLAIN on hot paths after beta traffic.

---

## Race conditions / deadlocks

| Area | Control |
|------|---------|
| Premium activate | Idempotent on payment id + user bind |
| Push claim | Service-role claim pattern |
| Streak awards | SQL race-safe notes in streak migrations |
| Poll close | **0063** prevents reopen races |

---

## Migration safety

- Additive style preferred (`if not exists`, drop/create policy).
- **Must apply on prod before relying on poll close:** `0062`, `0063`.
- Never auto-apply destructive drops in this pass.

---

## This pass

| Migration | Purpose |
|-----------|---------|
| **0063_poll_update_guard.sql** | Freeze poll identity/content; only `closes_at` / `anonymous` mutable; no reopen |

---

## Residual

- Single-region Supabase blast radius (ops).
- No multi-master conflict CRDT (not required for chat beta).

**DB is production-ready for beta** with migration apply discipline.
