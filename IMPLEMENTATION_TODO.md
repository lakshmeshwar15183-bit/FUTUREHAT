# IMPLEMENTATION_TODO — Notifications (2.4.0) + Admin Cleanup (2.4.1)

Legend: ✅ Completed · ⏳ In Progress · ⬜ Pending

## 12 — ADMIN SYSTEM CLEANUP (single permanent owner/admin)  ✅ code · ⏳ APK 2.4.1
- ✅ Backend already enforced by migration `0025` (applied): `admin_set_role` accepts only
  'user'/'moderator'; Owner is admin via `is_owner()` allowlist (independent of profiles.role);
  existing admin never downgradable via RPC. No new migration needed.
- ✅ `shared/adminApi.ts`: `adminSetRole` role type → `'user' | 'moderator'` (admin uncallable);
  dropped unused `PlatformRole` import.
- ✅ `mobile/.../admin/AdminUserDetailScreen.tsx`: removed "Assign Admin" button + hint.
- ✅ `web/src/admin/AdminUsers.tsx`: removed "Assign Admin" button + hint.
- ✅ Left intact: community/group participant 'admin' role (separate feature), moderator system,
  role-badge reads, owner-gated Admin dashboard nav.
- ✅ Mobile `tsc` EXIT 0 · web build clean · no residual admin-assignment refs.
- ✅ Version 2.4.0 → **2.4.1** (versionCode 21 → 22) across all 6 files.
- ✅ APK 2.4.1 (versionCode 22, ~123 MB) BUILD SUCCESSFUL (3m22s) → `~/Desktop/FUTUREHAT-2.4.1.apk`.

---

# Notification System (2.4.0) — shipped

Legend: ✅ Completed · ⏳ In Progress · ⬜ Pending

Resume rule: read this file + `PROJECT_PROGRESS.md` (top "Current checkpoint") first, then
continue from **RESUME HERE** below. Do NOT re-analyze the whole project. Prior features
(Status, Disappearing messages, Moderator System, Calls Module) history is in `PROJECT_PROGRESS.md`.

Spec = WhatsApp-quality notifications on Android + Web, with the revised sound rule: use the
DEVICE SYSTEM DEFAULT notification sound / ringtone automatically, NO in-app ringtone picker,
no extra native modules; show "Default (System)"; only store a custom URI if the user explicitly
picks one via Android's per-channel settings.

## N1 — Android Notification Channels  ✅
- ✅ 6 channels: messages, group_messages, calls, missed_calls, status, admin_system
- ✅ Per-channel importance / vibration / LED (lightColor) / `sound:'default'` / badge
- ✅ Versioned (`CHANNELS_VERSION` in AsyncStorage) — not recreated every launch
- ✅ Android system customization via per-channel settings (tone rows deep-link there)
- File: `mobile/src/lib/notifications.ts`

## N2 — Sound = device system default (revised spec)  ✅
- ✅ No bundled sounds anywhere; channels use `sound:'default'`
- ✅ Settings show "Default (System)" (`toneLabel`); custom only if explicitly chosen
- ✅ No in-app picker, no extra native module
- Files: `mobile/src/lib/notifications.ts`, `shared/notificationsApi.ts`, `NotificationsScreen.tsx`

## N3 — Settings page (WhatsApp layout)  ✅
- ✅ MESSAGE: Mute · Notification tone · Vibrate · Popup · High priority · Preview
- ✅ CALLS: Ringtone · Vibrate · Full-screen · Flash
- ✅ STATUS: Mute · GROUPS: Mute · Tone · Vibrate
- ✅ Mobile `NotificationsScreen.tsx` + Web `web/src/settings/NotificationSettingsModal.tsx`

## N4 — Message notifications  ✅ (minus remote avatar large-icon)
- ✅ Sender name, message preview, time, per-chat grouping (stable `chat:<id>` id), badge count
- ✅ Actions: Reply (text input) · Mark as read · Open chat (routing in NotificationsBridge)
- ⬜ Sender PHOTO as largeIcon — needs native; omitted (documented gap)
- Files: `mobile/src/lib/notifications.ts`, `mobile/src/components/NotificationsBridge.tsx`

## N5 — Call notifications  ✅ (minus native full-screen intent)
- ✅ MAX-priority call notification on `calls` channel (bypassDnd, PUBLIC lockscreen), Accept/Decline
- ✅ Ringtone + vibration via in-call manager (existing CallContext), rings until answered/rejected
- ⬜ True OS full-screen incoming-call intent — needs native; deliberately not added
- Files: `mobile/src/lib/notifications.ts`, `mobile/src/calls/CallContext.tsx`

## N6 — Background delivery  ✅ (open/background/minimised) · ⬜ killed-state
- ✅ App open / background / minimised via realtime local notifier (revised spec's required states)
- ⬜ Killed-state needs FCM: no `google-services.json`, `push` Edge Function NOT deployed → no-op fallback
- File: `mobile/src/components/NotificationsBridge.tsx`

## N7 — Firebase (client wired; infra pending)  ⏳
- ✅ Register token (`getDevicePushTokenAsync` → `registerPushToken` RPC), no dupes (push disables local notifier)
- ⬜ `google-services.json` absent; `push` Edge Function (FCM v1) not deployed
- ⬜ Token auto-refresh listener (`addPushTokenListener`) — minor, re-registered each launch
- Files: `mobile/src/lib/notifications.ts`, `shared/pushApi.ts`

## N8 — Web parity  ✅
- ✅ Notification API: message + call, permission request, click → focus + open chat, mute/preview
- Files: `web/src/lib/webNotifications.ts`, `web/src/lib/WebNotificationsBridge.tsx`

## N9 — Storage / sync  ✅
- ✅ `user_preferences.extra.notifications` (synced → restore on any device after login) + local cache
- Files: `shared/notificationsApi.ts`, `NotificationsScreen.tsx` (localCache)

## N10 — Backend migration  ✅
- ✅ `supabase/migrations/0025_notifications_and_single_owner.sql` (device_push_tokens + RPCs)
- ✅ APPLIED to remote (pooler `aws-1-ap-northeast-2`, `--include-all`); `migration list` shows 0025 local↔remote

## N11 — Build / version / ship  ⏳
- ✅ Mobile `tsc --noEmit` EXIT 0
- ✅ Web `npm run build` clean
- ✅ Verified `POST_NOTIFICATIONS` in packaged release manifest (Android 13+ OK, no prebuild needed)
- ✅ Version 2.3.0 → **2.4.0** (versionCode 20 → 21): app.json, both package.json, build.gradle, both branding.ts
- ✅ Release APK 2.4.0 (versionCode 21, ~123 MB) BUILD SUCCESSFUL (3m34s) → `~/Desktop/FUTUREHAT-2.4.0.apk`
- ✅ Tracking files updated (this file + PROJECT_PROGRESS.md)

## RESUME HERE (next session — say "continue")
1. If APK build unfinished/failed: `cd mobile && npm run build:release`, then copy
   `mobile/android/app/build/outputs/apk/release/app-release.apk` → `~/Desktop/FUTUREHAT-2.4.0.apk`.
2. Apply migration 0025 (ask user for DB password) + verify device_push_tokens/RPCs.
3. Optional: live on-device notification test; add google-services.json + push Edge Function for killed-state.
