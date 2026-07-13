# FINAL REMAINING LIMITATIONS — Lumixo

**Date:** 2026-07-12  
**Principle:** Do not claim 10/10 without evidence. List only what blocks further score, and what would be required.

---

## Platform / vendor ceilings (cannot “code away” fully)

| Limitation | Why | 10/10 would require |
|------------|-----|---------------------|
| OEM battery / FCM delay | Android Doze, MIUI, ColorOS kill apps | OEM partnerships, native persistent process, field SLOs |
| Expo / React Native | JS bridge, not pure native messenger | Native Android + iOS apps or extensive custom modules |
| WebRTC in RN | Stack maturity vs WA native | Battle-tested native WebRTC + TURN ops |
| Browser WebAuthn / localStorage App Lock | Not Secure Enclave for PIN | Platform authenticators + hardware keystore PIN |
| Supabase single project | Regional blast radius | Multi-region architecture |
| No Signal-protocol E2EE | Product architecture | MLS/Signal + key backup UX |
| iOS CallKit / PushKit | Certificates + native VoIP push | Full native iOS call stack |
| Android full-screen intent policy | User permission + OEM | Compliance + QA on API 34+ devices |

---

## Product / architecture gaps still fixable later (not blocking ship)

| Gap | Priority | Notes |
|-----|----------|-------|
| Web durable offline outbox | P1 | Mobile has full queue; web restores input on fail only |
| Offline message edit queue | P2 | `editMessage` is online-only |
| Action queue dead-letter UX | P2 | Silent drop after max attempts |
| Writing-tools edge rate limits | P2 | Premium + per-user limits |
| Group video / SFU | Product | 1:1 only |
| Full a11y audit all screens | P2 | Call controls done; rest incomplete |
| MMKV/SQLite local DB | P2 | AsyncStorage JSON limits scale |
| Production RUM / SLOs | Ops | Need dashboards post-ship |

---

## What we fixed that was fixable (do not re-open without regression)

- Free premium RPC, payment bind, system UPDATE forgery  
- Push grant surface, token hijack  
- Profile phone world-read  
- AppLock biometric bind + PIN KDF  
- Outbox re-flush + failed durability  
- WebRTC gUM hangup, ICE glare, offer mutex, double startCall  
- Notif reply correctness  
- Cache/media index races  
- XSS on group/contact media  
- Call control accessibility labels  

---

## Honest ceiling for *this* codebase

| Dimension | Max realistic now | Blocker |
|-----------|------------------:|---------|
| Production readiness | ~8.5 | Device OEM QA incomplete |
| Security | ~8.8 | No message E2EE; client lock ceiling |
| Notifications | ~9.0 after OEM farm | Hardware proof |
| Calls | ~8.5 with managed TURN | Still not CallKit/Telecom complete |
| Scalability | ~8.0 single region | Infra |
| Offline (mobile) | ~9.0 | Web lagging |

**Overall ceiling without native rewrite + multi-region + E2EE: ~8.5–8.7.**

---

## Engineering stop condition

This challenge stops when remaining work is:

1. **Ops / hardware validation**, or  
2. **Multi-month platform rewrites** (native, E2EE, SFU), or  
3. **Product features** outside reliability/security hardening.

All high-severity, in-repo software defects identified in the multi-pass audit that could be fixed without those programs **have been addressed**.
