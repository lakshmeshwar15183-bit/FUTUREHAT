# Lumixo Calling System — Production Pass Report

**Date:** 2026-07-12  
**Scope:** Mobile WebRTC + CallContext + signaling + tones + chat entries + notifications  

---

## Architecture (current)

```
startCall / Incoming INSERT
        │
        ▼
calls row (ringing → accepted | declined | missed | ended)
        │
        ├─ FCM push (ring / cancel)
        ├─ InCallManager (ringback caller / ringtone callee)
        └─ CallSession (getUserMedia → PC → broadcast SDP/ICE)
                │
                ▼
        ICE (+ TURN from EXPO_PUBLIC_TURN_*)
                │
                ▼
        Connected → timer · mute · speaker · camera
                │
                ▼
        end / bye → stop tones · update status
                │
                ▼
        trg_call_chat_message → system line in chat
```

---

## Bugs found & fixed this pass

### CRITICAL / HIGH

| Bug | Root cause | Fix |
|---|---|---|
| **Ringback “tuuu…” continues** | Double-start: `start({ringback:'_DTMF_'})` + `startRingback()`; stop only on ICE connected; OEM keeps tone after one stop | Single ringback owner; `stopAllTones()` on answer / connect / end (triple stop around `InCallManager.stop`) |
| **Incoming subscription thrash** | `useEffect([uid, active, incoming])` re-bound channel on every state change → missed hangups | Stable `useEffect([uid])` + `activeRef` / `incomingRef` |
| **Hangup double / stuck** | `onEnded` + unmount both re-entered hangup | `finished` flag + clear `activeRef` before async work |
| **Caller no-answer never times out** | Only callee had 60s timer | Caller 55s → `missed` + end session |
| **Chat has no call entries** | Calls only in Calls tab | Migration `0046`: system message per terminal call (duration / missed / declined / cancelled) |

### Supporting

- Stop ringback when **SDP answer** arrives (not only ICE connected)
- Status `accepted` stops caller ringback early
- System pill UI strips `[call:uuid]` and shows call icon (missed in red)
- Black base + live-track gate already prevent white remote SurfaceView

---

## Files modified

| File | Change |
|---|---|
| `mobile/src/calls/webrtc.ts` | Tone control, stop-on-answer, hardened `end()` |
| `mobile/src/calls/CallContext.tsx` | Stable subscribe, refs, hangup guard, caller timeout |
| `mobile/src/screens/ChatScreen.tsx` | Call system message presentation |
| `supabase/migrations/0046_call_chat_system_messages.sql` | Chat call lines |

---

## Lifecycle coverage

| State | Handled |
|---|---|
| Idle → Calling | `startCall` → create row + ActiveCallView + ringback |
| Ringing (callee) | INSERT + ringtone / FCM |
| Connecting | After accept / answer; ringback off; ICE |
| Reconnecting | ICE restart ≤3 + disconnect grace 16s |
| Connected | Timer + net bars |
| Mute / speaker / camera | Session toggles |
| Ended / declined / missed | Status + tones stop + chat line + push cancel |
| Busy | Second call auto-declined |
| Timeout | 55s caller / 60s callee → missed |
| Failed | Connect watchdog 45s → end |

---

## Remaining risks (not full WhatsApp parity)

| Risk | Severity | Notes |
|---|---|---|
| No native ConnectionService / CallStyle full-screen | HIGH quality | Heads-up + overlay; not dialer-class when killed on some OEMs |
| Group calls | N/A | Product scope is 1:1 |
| Hold | Not supported | — |
| Public TURN quality / limits | MEDIUM | Depends on metered.ca plan |
| Bluetooth route switching | MEDIUM | Relies on InCallManager auto |
| Multi-device simultaneous answer | MEDIUM | First accept wins; others should hang on status |
| Load test 1000 calls | Not run in CI | Manual / lab required |
| iOS PushKit VoIP | HIGH for iOS killed | Android FCM path stronger |

---

## Stress / lab (code-level, not physical)

| Test | Result |
|---|---|
| Double hangup | Guarded by `finished` / `ended` |
| Rapid accept | Incoming cleared before status write |
| Ringback double-start | Eliminated |
| ICE restart | Max 3 attempts |
| White video | Still gated on live video track + black base |

Device matrix (2G–5G, 2h call, Bluetooth) **must** be run on hardware before public launch.

---

## Security

| Item | Status |
|---|---|
| Call RLS (members only) | ✅ |
| Signaling broadcast scoped to call channel | ✅ (not stored) |
| TURN credentials in app env | ⚠️ shared client secret (typical for app TURN; rotate via provider) |
| Unauthorized join | ✅ need conversation membership + call id |
| Encrypted media | ✅ DTLS/SRTP via WebRTC |

---

## Performance targets

| Metric | Target | Expectation |
|---|---|---|
| Connect (same LAN) | &lt;3s | Usually yes |
| Connect (cellular + TURN) | &lt;3–5s | Depends on TURN RTT |
| Ringback stop on answer | Immediate | Fixed (SDP answer + status accepted) |
| Battery | Minimal | Proximity/speaker APIs used; long video still costly |

---

## Production readiness score

| Area | Score |
|---|---|
| Signaling / ICE | 8.0 |
| Audio tones / routing | 8.5 (after this pass) |
| Video white-screen / mirror | 8.0 |
| UI (full + minimized) | 8.0 |
| Chat call entries | 8.5 (new) |
| Killed-state incoming | 7.0 (Android FCM; not full Telecom) |
| Stress lab evidence | 5.0 |
| **Overall** | **7.8 / 10** |

---

## Verdict

| Gate | Decision |
|---|---|
| Closed beta 1:1 calls | **GO** (with TURN configured) |
| Open beta | **GO** after device QA of ringback + missed/chat lines |
| Public WhatsApp-parity claim | **NO** until CallStyle/Telecom + lab stress + iOS VoIP path |

**Do not claim “behaves exactly like WhatsApp under all real-world conditions”** without hardware stress results.  
**Do claim** production-ready **1:1 voice/video for beta**: stable lifecycle, tone hygiene, chat history lines, ICE recovery, TURN-ready.
