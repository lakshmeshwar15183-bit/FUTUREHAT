# FINAL SCALABILITY REPORT — Lumixo

**Date:** 2026-07-12  
**Score: Scalability 7.6 / 10**

---

## Current architecture capacity

```
Clients (web/mobile)
    → Supabase Auth / PostgREST / Realtime / Storage
    → Edge Functions (push, payments, ai, crash-report, account-purge)
    → Postgres + RLS
    → FCM (via service account)
```

| Component | Scale posture |
|-----------|---------------|
| Postgres RLS | Correct for multi-tenant isolation; CPU cost per query |
| Realtime | Per-conversation channels; fine for mid-market, not mega-group broadcast |
| Push outbox | Claim/limit batching; cron + opportunistic drain |
| Storage | Private media + signed URLs; bandwidth-bound |
| Edge Functions | Stateless; FCM fan-out is the cost center |

---

## Hardening that helps scale

- Push RPCs service_role only (prevents client thrashing claim)  
- `sendPush` no longer drains 50 global jobs per client message  
- Message cache bound (800/thread)  
- Media index bound (~2000 entries)  
- Payment unique index on provider payment id  

---

## Scaling limits (honest)

| Limit | Why | Path to 9–10 |
|-------|-----|----------------|
| Single Supabase project / region | Latency + blast radius | Multi-region read replicas + edge routing |
| Realtime for huge groups | Broadcast fan-out | Dedicated fanout service / silent notifications |
| FCM per-device | Provider quotas | Topic strategy carefully; enterprise quotas |
| No CQRS / read models | List queries on OLTP | Materialized conversation summaries |
| Edge cold starts | Deno isolate | Keep-warm / dedicated workers for push |
| WebRTC mesh (1:1 only) | Product scope | SFU (LiveKit/mediasoup) for group calls |

---

## Target operating envelopes (engineering estimate)

| Metric | Comfortable | Stress |
|--------|-------------|--------|
| DAU | 10k–50k | 100k+ needs read path work |
| Concurrent 1:1 calls | Hundreds (TURN capacity) | Need TURN cluster |
| Msg/s global | Low thousands | Partition / queue |
| Group size | Hundreds | Thousands needs design change |

---

## Score justification

7.6 reflects a well-structured single-region BaaS architecture with solid isolation, **not** a globally sharded messenger. Raising score requires infra beyond this codebase.
