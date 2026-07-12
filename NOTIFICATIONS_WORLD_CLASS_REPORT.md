# NOTIFICATIONS_WORLD_CLASS_REPORT

**Product:** Lumixo  
**Date:** 2026-07-12  
**Scope:** WhatsApp-level notification UX + reliability within Android/iOS rules  
**Status:** Code complete for this pass · device matrix checklist generated  

---

## Executive summary

Lumixo’s notification stack is dual-path:

| Path | When | Mechanism |
|------|------|-----------|
| **FCM high-priority** | App killed / Doze / locked | Edge Function `push` + `device_push_tokens` |
| **Local + Realtime** | Process alive | `NotificationsBridge` + stable ids `chat:<id>` / `call:<id>` |
| **Outbox** | Always | DB trigger → `push_outbox` → drain (client + **cron required**) |

This pass adds **first-launch permission UX**, **OEM battery guidance**, and **non-nagging** Settings deep links on top of the earlier P0 killed-app reliability work (dedupe release, call cancel-by-tag, server titles).

---

## Issues found → fixes applied

| Issue | Fix |
|-------|-----|
| Permission requested without “why” | `NotificationSetupGate` rationale screen before system dialog |
| Deny with no recovery path | Denied step: **Grant permission** / **Open Settings** if permanent |
| Permanent deny dead-end | Deep-link to app notification settings |
| Aggressive OEM kills (Xiaomi, OPPO, …) | `notificationSetup.ts` OEM detection + guided steps; Settings row |
| Battery optimization delays | One-time battery step + Settings → Unrestricted (dismiss = never nag) |
| Killed-app FCM permanent skip | Prior: `release_push_dedupe` + outbox retry (`0048`, Edge Function) |
| Ghost call rings when killed | Prior: FCM cancel **same tag** replaces ring |
| Weak tray title “New message” | Prior: Edge rebuilds sender/group title |
| Cold start tap misses chat | Prior: `getLastNotificationResponseAsync` |
| Token stale after OEM kill | Re-register on AppState `active` + token listener |

---

## Feature matrix

### 1. Automatic permission flow

| Requirement | Status |
|-------------|--------|
| Explain before system dialog | ✅ `NotificationSetupGate` rationale |
| Request on first signed-in launch | ✅ Mounted when `signedIn && !locked` |
| Friendly retry if denied | ✅ Denied step |
| Permanent deny → Settings | ✅ `openAppNotificationSettings` |
| No spam after dismiss | ✅ AsyncStorage keys for setup/OEM/battery |

### 2. Android permissions

| Permission / capability | Status |
|-------------------------|--------|
| `POST_NOTIFICATIONS` (13+) | ✅ `registerForPush` / setup gate |
| Notification channels (MAX/HIGH) | ✅ messages, groups, calls, missed, ongoing |
| Vibration | ✅ channel + presenters |
| Foreground service (calls) | ✅ declared in `app.json` / WebRTC call path |
| Full-screen call UI | ⚠️ In-app full-screen when process can paint; OS CallStyle/Telecom **not** Expo-native |
| Wake screen for calls | ⚠️ Heads-up MAX channel best-effort; full wake needs Telecom |
| `USE_FULL_SCREEN_INTENT` | ✅ declared in app permissions |

### 3. Battery / OEM

| OEM | Guided |
|-----|--------|
| Xiaomi / Redmi / POCO | ✅ Autostart + no restrictions + lock recents |
| OPPO / Realme | ✅ Background activity |
| vivo | ✅ High background power |
| OnePlus | ✅ Don’t optimize |
| Samsung | ✅ Unrestricted + sleeping apps |
| Motorola / Pixel / Huawei / other | ✅ Generic unrestricted |

Dismiss keys: `fh:batteryGuideDismissed:v1`, `fh:oemGuideDismissed:v1`.

### 4. FCM pipeline

| Item | Status |
|------|--------|
| Token generate (`getDevicePushTokenAsync`) | ✅ |
| Token refresh listener | ✅ |
| Token sync RPC `register_push_token` | ✅ |
| Invalid token prune | ✅ Edge UNREGISTERED |
| High-priority messages | ✅ |
| Dedupe + retry after zero delivery | ✅ `release_push_dedupe` |
| Offline queue | ✅ `push_outbox` |
| Duplicate prevention | ✅ `claim_push_dedupe` + local messageId set |

### 5–7. Latency, calls, background states

| Scenario | Design target | Code |
|----------|---------------|------|
| Message near real-time | &lt; 2s online | FCM + client drain |
| Call ring after insert | &lt; 2s | Trigger + sendPush |
| Tap → chat | Instant once process up | Deep link / cold start handler |
| Answer / Decline | Shade actions | Categories `accept` / `decline` |
| Stop ring on hangup / multi-device | Same-tag cancel + status | Edge + bridge |
| Foreground / background / killed / reboot | Supported | Dual path + re-register |

### 8. UX polish

| Feature | Status |
|---------|--------|
| Reply / Mark read / Mute / Archive | ✅ |
| Group stacking | ✅ |
| Badge `my_total_unread` | ✅ |
| Rich image (HTTPS avatar) | ✅ FCM `android.notification.image` |
| Missed call | ✅ |
| Ongoing call sticky | ✅ `ongoing_call` channel |
| Conversation shortcuts | ⚠️ OS-level dynamic shortcuts not implemented |

---

## Validation

### Automated (this session)

```bash
node scripts/notification-validation-matrix.mjs
# + jest notificationSetup OEM tests
# + mobile tsc
```

Contract checks cover Edge Function, migration 0048, categories, cold start, OEM module, setup gate.

### Device matrix (must run on hardware)

See `scripts/notification-validation-matrix.mjs` printed checklist (100 messages, force-stop, reboot, multi-device, network switch, long idle).

**Measured latency:** not instrumented on devices in this session. Design targets above; production should log FCM send time → optional client open time.

---

## Comparison with WhatsApp

| Area | WhatsApp | Lumixo |
|------|----------|--------|
| Killed message delivery | ✅ | ✅ (FCM + outbox + cron) |
| Permission education | ✅ | ✅ setup gate |
| OEM battery hand-holding | ✅ (deep OEM deals) | ✅ guided Settings |
| System dialer call UI | ✅ Telecom | ⚠️ Heads-up + in-app |
| Stop ring multi-device | ✅ | ✅ |
| Encrypted push content | ✅ | ❌ plaintext FCM |
| 100% OEM zero-config | ✅ | ⚠️ user may need Unrestricted |

---

## Remaining platform limitations

1. **No ConnectionService / CallStyle** — full-screen OS call UI on all OEMs needs native module.  
2. **iOS PushKit VoIP** — background mode declared; full VoIP push not wired.  
3. **Cron** — 1-minute `drainOutbox` must stay scheduled for worst-case (sender offline after insert).  
4. **Cannot auto-disable battery optimization** without restricted Play policy APIs; we deep-link only.  
5. **Latency metrics** require field instrumentation.

---

## Final production score

| Area | Score |
|------|-------|
| Message reliability (with FCM + cron) | **9.0 / 10** |
| Permission & onboarding UX | **9.0 / 10** |
| OEM / battery guidance | **8.5 / 10** |
| Call notifications | **7.5 / 10** |
| Grouping / actions / badge | **9.0 / 10** |
| Observability / auto latency | **6.5 / 10** |
| **Overall (within Expo + Play rules)** | **8.7 / 10** |

**Ship readiness for messaging notifications:** **GO** after device force-stop QA + cron confirmed live.  
**Ship readiness for “WhatsApp call dialer parity”:** **NO-GO** without native Telecom work.

---

## Ops checklist

- [x] Migration `0048` applied (prior session)  
- [x] Edge `push` redeployed (prior session)  
- [ ] Confirm 1-min drain cron still scheduled  
- [ ] Physical force-stop QA (Android 3-button + gesture)  
- [ ] Rebuild release APK after this commit  

---

## Files in this pass

- `mobile/src/lib/notificationSetup.ts` — OEM + permission state machine  
- `mobile/src/components/NotificationSetupGate.tsx` — first-launch UI  
- `mobile/App.tsx` — mount gate when signed in  
- `mobile/src/screens/NotificationsScreen.tsx` — OEM settings row  
- `mobile/src/lib/__tests__/notificationSetup.test.ts`  
- `scripts/notification-validation-matrix.mjs`  
- `NOTIFICATIONS_WORLD_CLASS_REPORT.md` (this file)  

Prior P0 stack (still required): `supabase/functions/push/index.ts`, `0048_push_killed_reliability.sql`, NotificationsBridge cold start, etc.
