# Device-proof checklist (FCM kill + call NAT)

Measure — do not claim pass without `validation/results/device-proof-LATEST.json`.

## Setup

1. Two physical devices (A = sender, B = receiver).  
2. Production-like build with **TURN configured** (`EXPO_PUBLIC_TURN_*`).  
3. `CRON_SECRET` set on Edge + scheduled drain (see `scripts/setup-ops-crons.sh`).  
4. Run: `node scripts/device-proof-harness.mjs --write-template`

## FCM force-stop

1. On B: open app once (token register), then **force-stop** from Recents.  
2. On A: send **20+** messages to B.  
3. On B: unlock / open notification; Diagnostics shows latency samples (`sentAt` → receive).  
4. Record p50/p95 and miss count into `device-proof-LATEST.json`.

**Pass:** p95 ≤ 5000 ms, miss rate ≤ 2%, n ≥ 20.

## Call killed ring + hangup cancel

1. B force-stopped.  
2. A places call → B rings (CallStyle / FSI).  
3. A hangs up → B ring cancels ≤ 2s.  
4. Record samples.

## Cross-NAT call

1. A on Wi‑Fi, B on LTE (or different NATs).  
2. Complete call; confirm ICE path **relay** when needed.  
3. Connect p95 ≤ 15s.

## After session

```bash
# Merge operator JSON → validation/results/device-proof-LATEST.json
node scripts/device-proof-harness.mjs
```

Export mobile samples: Settings → Diagnostics → copy latency summary / device proof (if exposed).
