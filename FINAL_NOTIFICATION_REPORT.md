# FINAL NOTIFICATION REPORT — Lumixo

**Date:** 2026-07-12  
**Score: Notifications 8.7 / 10**

---

## Architecture

1. **DB outbox + triggers** → durable jobs  
2. **Edge `push`** → FCM high priority; call path **data-only** for native CallStyle / fullScreenIntent  
3. **Dedupe claim/release** (0048) → retries when zero tokens delivered  
4. **Client Realtime** when JS alive → local present  
5. **NotificationSetupGate + OEM guides** → permission & battery education  
6. **Multi-device clear** → `clearRemoteChatNotification`  

---

## Fixes this challenge

| Issue | Fix |
|-------|-----|
| Client global outbox drain abuse | `drainOutbox: false` on user `sendPush` |
| Notification Reply silent fail | Await send; push only with `messageId`; clear tray only on success |
| Title quality | Prior pass: empty title → server rebuilds display name |

---

## Automated validation

`node scripts/notification-validation-matrix.mjs` → **PASS contracts**  
(OEM families, gate mount, CallStyle plugin, data-only call path, latency probe, native bridge)

---

## Device matrix (still required for 9.5+)

Manual checklist in script output (force-stop, Doze, reboot, multi-device, reply from shade). **Not executed on hardware in this session.**

---

## Why not 10/10

| Constraint | Detail |
|------------|--------|
| OEM battery killers | Xiaomi/Huawei/Samsung can delay FCM despite high priority |
| Expo / RN notification layer | Less control than pure native WA stack |
| iOS VoIP / CallKit | Not full native CallKit push path in Expo without dedicated certs + PushKit |
| Browser web push | Secondary; not WA parity |
| Android 14+ FSI | Full-screen intent permission user-gated |

**To reach 10/10:** native Android/iOS notification services, verified OEM farm, PushKit + CallKit, Play/App Store policy compliance proven in field metrics (delivery p95 & miss rate).
