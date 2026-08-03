# FINAL CALL SYSTEM REPORT — Lumixo

**Date:** 2026-07-12  
**Score: Calls 7.8 / 10**

---

## Stack

- Signaling: Supabase Realtime broadcast + `calls` table status  
- Media: `react-native-webrtc` + InCallManager  
- ICE: STUN + optional TURN (`EXPO_PUBLIC_TURN_*`)  
- UX: Incoming overlay, ActiveCallView, ongoing notification, missed call  

---

## Bugs fixed this challenge

| Bug | Why | Fix |
|-----|-----|-----|
| Hangup during getUserMedia | Permission dialog race left tracks live | Abort path stops tracks if `ended` |
| ICE restart glare | Callee also created restart offer on stable | **Caller-only** ICE restart + `iceRestartInFlight` |
| Concurrent createOffer | Multiple ready pings | `offerInFlight` mutex |
| Double startCall | Double-tap before active set | `startingRef` + early `activeRef` claim |
| Stuck ring after hangup | Single 400ms poll | Interval poll 2.5s + Realtime status |
| a11y | Buttons unlabeled | `accessibilityLabel` on Accept/Decline/controls/hangup |

---

## Call-test script

`scripts/call-test` layer in validation suite: **PASS** (mocked/unit bundle path).

---

## Remaining call risks

| Risk | Severity | Mitigation / limit |
|------|----------|--------------------|
| No TURN in env | P0 ops | Cross-NAT fails; UI warns “Call anyway” |
| Expo WebRTC quality | P1 | Hardware AEC varies by OEM |
| No SFU / group calls | Product | 1:1 only |
| iOS CallKit / Android Telecom full integration | P1 | Plugin path partial; not carrier-grade |
| Signaling not store-and-forward | P1 | Offer retransmit + ready heartbeat |

---

## Why not 10/10

WhatsApp-class calling needs: managed TURN/TCP/TLS relays, native call UI stack (ConnectionService/CallKit), field telemetry, PSTN interop, group SFU. This codebase is a strong **app-layer 1:1 WebRTC product** on Expo, not a telco-grade system.

**Required for 10/10:** dedicated TURN cluster, native call modules, multi-device call pull, extensive device lab (Wi-Fi↔LTE handoff, dual-SIM, BT SCO).
