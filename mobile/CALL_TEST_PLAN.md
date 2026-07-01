# FUTUREHAT — Call verification plan (live, evidence-based)

**Status of the fix: UNVERIFIED.** The signaling *substrate* is proven live
(see below), but the actual WebRTC media/ICE path and the "stuck on Connecting…"
fix **cannot be verified without two real Android phones.** This document is the
harness to prove it the moment phones are connected.

---

## What is ALREADY proven live (real execution, not static analysis)

`node scripts/diag_calls_full.mjs` — run against the real Supabase project:

| Stage | Result |
|---|---|
| Two users authenticate | ✅ |
| Direct conversation (RLS) | ✅ |
| Caller INSERT `calls` → callee receives via postgres_changes (incoming ring) | ✅ (~0.5s) |
| ready → offer → answer → candidate over `call:<id>` broadcast | ✅ both directions |

This proves delivery of the SDP/ICE messages. It uses **placeholder** SDP/ICE,
so it does **NOT** prove real peer-connection, ICE gathering, TURN, media, or the
UI transition. Those need devices.

## What is NOT yet proven (requires 2 phones)

Real `RTCPeerConnection`, real offer/answer SDP, ICE candidate gathering
(host/srflx/**relay** ⇒ TURN), `iceConnectionState`/`connectionState` reaching
connected, media tracks, the **Connecting… → Ringing → Connected** UI flip, the
60s hold, network drop/recovery, and reject/cancel/timeout.

---

## Blockers to live verification (as of this machine)

1. **No Android device connected** (`adb devices` empty). — YOU must connect a phone.
2. ~~No JDK to build v1.3.4~~ → being installed (`openjdk@17`). Once done, only #1 remains.
3. Two phones needed for a *real* 2-party call (voice + video, network toggle).
   One phone can still test outgoing→ICE→media against the diag scripts, but
   reject/cancel/timeout and reconnect are best with two.

Emulators are **not** suitable: no camera/mic media path, unreliable WebRTC, and
can't do a real network drop.

---

## One-command run (after connecting phone(s))

```bash
cd mobile
scripts/run-call-test.sh          # builds v1.3.4 release, installs, launches, captures [call] logs
```

Logs land in `mobile/call-test-logs/call-<timestamp>-<device>.log` per device.

---

## The 10 requirements → action → log evidence to confirm

Watch each device's log (tags: `[call]` from JS, `org.webrtc` native).

| # | Requirement | Action | PASS evidence in log |
|---|---|---|---|
| 1 | Two live clients | Install on both phones | app launches both |
| 2 | Two different users | Sign in user A on phone 1, user B on phone 2 | distinct auth in app |
| 3 | Voice call | A calls B (audio) | `[call] CALLER start() audio` / `[call] CALLEE start() audio` |
| 4 | Video call | A calls B (video) | `[call] … start() video`; `[call] ontrack video` |
| 5a | Offer | during call | `[call] CALLER → offer` then callee `[call] signal IN: offer` |
| 5b | Answer | during call | callee `[call] CALLEE → answer`; caller `[call] signal IN: answer` |
| 5c | ICE candidates | during call | repeated `[call] local ICE candidate host/srflx/relay`; `[call] local ICE gathering complete` |
| 5d | ICE connection state | during call | `[call] iceConnectionState: checking → connected/completed` (NOT `failed`) |
| 5e | Peer connection state | during call | `[call] connectionState: connecting → connected` |
| 5f | Media tracks | during call | `[call] ontrack audio` (voice) / `ontrack video` (video), `streams: 1` |
| 6 | UI Connecting→Ringing→Connected | watch both screens | caller "Ringing…", callee "Connecting…", both flip to timer; log `[call] ✅ CONNECTED` |
| 7 | ≥60s connected | let it run 60s | timer passes 1:00; no `connectionState terminal` before then |
| 8 | Drop + reconnect network | toggle Wi-Fi/airplane on one phone mid-call | `[call] disconnected — 12s grace`; on restore `[call] ✅ CONNECTED` again (recovered within grace) |
| 9a | Incoming | B receives A's call | incoming call UI shows on B |
| 9b | Outgoing | A initiates | A shows "Ringing…" |
| 9c | Reject | B taps decline | call ends both sides; status `declined` |
| 9d | Cancel | A hangs up before B answers | call ends; status `ended`/`missed` |
| 9e | Timeout | A calls, B never answers | call auto-ends after ring timeout |
| 10 | Logs per stage | automatic | `call-test-logs/*.log` captured per device |

### The specific fix to scrutinize (requirement 6/8)
`webrtc.ts` now fires connected on **either** `connectionState` **or**
`iceConnectionState` reaching connected/completed. To confirm the fix actually
matters, check the log: if you see `iceConnectionState: connected` **before**
`connectionState: connected` (or connectionState never reaching connected) yet
the UI still shows the timer, the dual-signal path is what saved it.

### If it still fails
The log pinpoints the exact stalled stage:
- No `relay` candidate + `iceConnectionState failed` → **TURN not working** (cross-network).
- Offer sent but no `signal IN: answer` → **signaling/answer path**.
- `CONNECTED` logged but UI stuck → **UI wiring** (CallContext), not WebRTC.

Capture that log, and the fix target is unambiguous — then rebuild via the same
script and re-verify.
