# NOTIFICATIONS_FINAL_REPORT — Killed-App Reliability (P0)

**Date:** 2026-07-12  
**Scope:** End-to-end message + call push when Lumixo is closed / force-stopped  
**Target:** WhatsApp-class delivery without the app process  

---

## Root causes found

| # | Bug | Effect when app is killed |
|---|-----|---------------------------|
| 1 | **Dedupe claimed before FCM** | If first fan-out had 0 tokens or FCM failed, `claim_push_dedupe` still recorded success → outbox treated later sends as duplicates → **permanent silence** |
| 2 | **Outbox drain always “delivered”** | Zero-FCM jobs marked complete → no retry with backoff |
| 3 | **Call cancel was data-only** | Ring notification stayed in tray (system cannot remove remote notifs via silent data) → **ghost rings** |
| 4 | **Client title race** | Mobile often sent title `"New message"` and won the race → weak tray copy |
| 5 | **Drain depends on live clients** | Without cron, if sender `sendPush` fails, outbox sits until another client drains |
| 6 | **Cold-start tap** | No `getLastNotificationResponseAsync` path → tap after kill could miss deep-link |
| 7 | **OEM battery** | No clear Settings path to Unrestricted battery (common on Samsung/Xiaomi/etc.) |

Not root causes (already OK):

- FCM high priority + channel MAX/HIGH  
- `google-services.json` present  
- DB triggers enqueue `push_outbox`  
- Android 13 `POST_NOTIFICATIONS` request path  
- Accept/Decline categories for calls  

---

## Fixes applied

### Edge Function `supabase/functions/push/index.ts`

1. **`release_push_dedupe`** when delivery is 0 (no tokens / all FCM fail) so outbox can retry.  
2. **Outbox drain** marks complete only when `complete || delivered > 0 || skippedDup` (true prior win / mute-all / no recipients).  
3. **Call cancel** uses **same Android `tag`** as ring (`call:<id>`), non-sticky notification that **replaces** the ring when the app is dead.  
4. **Server-side titles** for messages (ignore generic client titles; use profile/conversation names).  
5. FCM rings are **non-sticky** so cancel-by-tag works; `direct_boot_ok` + high priority retained.  
6. All-muted recipients count as **complete** (no infinite retry).

### Migration `0048_push_killed_reliability.sql`

- `release_push_dedupe(p_key)`  
- `push_outbox_pending_count()` for ops health  

### Mobile

| File | Change |
|------|--------|
| `notifications.ts` | Stronger `registerForPush`, permission helpers, battery/settings openers, call notif non-sticky, channels v7 |
| `NotificationsBridge.tsx` | Cold-start `getLastNotificationResponseAsync` + shared response handler |
| `NotificationsScreen.tsx` | System section: permission status + battery optimization guidance |
| `sync.ts` | Empty title so Edge rebuilds sender name |
| `shared/pushApi.ts` | Docs + drain limit 50 |

---

## Architecture (after fix)

```
Sender inserts message/call
        │
        ├─► push_outbox (DB trigger, authoritative)
        └─► client sendPush (best-effort, drains outbox)

Edge Function push
        ├─ claim_push_dedupe
        ├─ FCM high priority (notification+data)
        ├─ if delivered=0 → release_push_dedupe (retryable)
        └─ prune UNREGISTERED tokens

Cron (ops, every 1 min)
        └─ POST /functions/v1/push { drainOutbox:true }

Device tray (app killed)
        └─ Android System / APNs show FCM (no JS required)
```

---

## Ops required for production

1. **Apply migration** `0048_push_killed_reliability.sql`  
2. **Redeploy** Edge Function:  
   `SUPABASE_ACCESS_TOKEN=… bash scripts/deploy-push.sh`  
3. **Confirm secret** `FCM_SERVICE_ACCOUNT` on the project  
4. **Schedule drain every 1 minute** (Dashboard or external cron):  

```http
POST https://toscljrivrawvlfebdzz.supabase.co/functions/v1/push
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type: application/json

{"drainOutbox":true,"limit":100}
```

See `scripts/setup-ops-crons.sh`.

Without (4), reliability still depends on a live sender client calling `sendPush` / drain after each message.

---

## Test matrix

| Scenario | Expected | Status |
|----------|----------|--------|
| Foreground, other chat | Local + FCM collapse; no spam in open chat | Code path OK — device QA |
| Background | Tray heads-up | Code path OK |
| **Killed (force-stop)** | FCM message with **sender name** title | Fixed (dedupe + title) — **device QA required** |
| Locked screen | High priority + public visibility | Configured |
| Incoming call killed | Ring on MAX channel | Configured |
| Call end / decline killed | Ring **replaced** (no ghost) | Fixed (tag replace) |
| Missed call | missed_calls channel | Configured |
| Airplane → online | Outbox retry + drain | Needs cron + device QA |
| Wi-Fi ↔ mobile | FCM redelivery | OS/FCM |
| Reboot | Token re-register on active | Bridge re-registers |
| Multi-device read | clear_chat silent + local clear | Configured |
| Dedupe zero-token first attempt | Retry after token register | Fixed release |

**Automated:** mobile `tsc` (run at commit). Full device matrix must be run on physical Android with 3-button / force-stop.

---

## Comparison vs WhatsApp

| Capability | WhatsApp | Lumixo after this work |
|------------|----------|-------------------------|
| Message when force-stopped | ✅ | ✅ FCM + outbox + retry (with cron) |
| Correct sender title when killed | ✅ | ✅ server rebuild |
| Call ring when killed | ✅ Telecom | ✅ FCM MAX channel heads-up |
| Full system dialer UI | ✅ ConnectionService | ⚠️ Heads-up + in-app full screen when process can show UI |
| Cancel ring when killed | ✅ | ✅ same-tag replace |
| Accept/Decline from shade | ✅ | ✅ notification categories |
| OEM battery exemptions | Years of OEM deals | ⚠️ User Settings guidance |
| Encrypted push payload | ✅ | ❌ plaintext FCM (by design today) |

---

## Remaining limitations

1. **No Android Telecom / ConnectionService** — cannot match native dialer full-screen on every OEM without a native module.  
2. **iOS PushKit VoIP** not fully wired (background mode declared only).  
3. **Cron must be live** for worst-case (sender offline after insert fails client push).  
4. **Harsh OEMs** (aggressive autostart) may still need user “Unrestricted battery” / Autostart.  
5. **Device QA** of the full matrix was not executed in this session (code + unit typecheck only).

---

## Sign-off

| Item | Status |
|------|--------|
| Root causes identified | ✅ |
| Code fixes for dedupe / cancel / titles / cold start | ✅ |
| Migration 0048 | ✅ |
| Ops drain documented | ✅ |
| Production blocker (code) | ✅ mitigated — **enable cron + deploy + device QA before store ship** |

---

## Files changed

- `supabase/functions/push/index.ts`  
- `supabase/migrations/0048_push_killed_reliability.sql`  
- `mobile/src/lib/notifications.ts`  
- `mobile/src/components/NotificationsBridge.tsx`  
- `mobile/src/screens/NotificationsScreen.tsx`  
- `mobile/src/lib/sync.ts`  
- `shared/pushApi.ts`  
- `NOTIFICATIONS_FINAL_REPORT.md`  
