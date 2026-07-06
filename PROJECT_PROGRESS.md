# PROJECT_PROGRESS — FUTUREHAT (Mobile + Web parity)

> Resumable log. A new session should read THIS file + `IMPLEMENTATION_TODO.md` +
> `SESSION_RESUME.md` first, then continue from **Current checkpoint** below. Do not
> re-analyze the whole project.

## Current checkpoint
**🟡 iOS ENABLEMENT (v2.4.3) — CONFIG + CROSS-PLATFORM FIXES DONE + VERIFIED. Mobile `tsc` EXIT 0, `expo-doctor` 18/18 PASS, `expo config` resolves iOS cleanly. Build path chosen = EAS cloud. NOT built yet (needs user's Expo/Apple account). Android side untouched.**

### iOS Enablement — what's done (2026-07-05)
Making the app buildable for iOS (first-time). No Android regression.
- **app.json iOS config (done):** `buildNumber: "24"`, `infoPlist` = `ITSAppUsesNonExemptEncryption:false` +
  `NSPhotoLibraryAddUsageDescription` + `UIBackgroundModes:[audio]`; `expo-build-properties` iOS
  `deploymentTarget: 15.1`; improved Face ID / camera / mic permission strings (cross-platform).
  Version bumped 2.1.0(committed baseline)→**2.4.3**, android versionCode→24, iOS buildNumber 24.
- **`mobile/eas.json` (new, untracked):** dev / preview / production profiles, `appVersionSource: local`.
- **Phase 3 cross-platform fixes (done this session):** audit found the app already cross-platform
  clean — every `Platform.OS` guard correct, all native modules (InCallManager, expo-local-auth,
  expo-file-system, Sharing, WebRTC) work on iOS, BackHandler is a safe iOS no-op, MediaViewer
  "download" uses the iOS share sheet, keyboard handling branches for iOS. Only deltas fixed:
  (1) added iOS shadow parity to two elevation-only FABs (`NewGroupScreen`, `ScheduledCallsScreen`);
  (2) `NotificationsScreen.openChannelSettings` now falls through to `Linking.openSettings()` on iOS
  (iOS has no notification channels) instead of dead-ending the tone row.
- **`mobile/package.json` `expo.doctor.reactNativeDirectoryCheck` exclude added** for the known WebRTC
  calling deps (incall-manager, webrtc, @config-plugins/react-native-webrtc, expo-av) so doctor = 18/18.

### iOS Enablement — RESUME HERE (next session)
1. **EAS build (needs user):** `cd mobile && npx eas login` (user's Expo account) → `eas build:configure`
   if prompted → `eas build -p ios --profile preview` (or `production`). EAS provisions Apple creds
   interactively (Apple ID + app-specific password, or App Store Connect API key).
2. Regenerated `ios/` is gitignored CNG — do NOT commit it; EAS/prebuild regenerates from app.json.
3. After a successful build, record the build URL / .ipa here and flip this checkpoint to 🟢.

---

## Previous checkpoint
**🟢 Permanent-Owner Protection (v2.4.2) — SHIPPED + VERIFIED. Mobile `tsc` EXIT 0, web `npm run build` clean. Version 2.4.2 (versionCode 23). ✅ APK BUILD SUCCESSFUL (~118 MB) → `~/Desktop/FUTUREHAT-2.4.2.apk` (aapt: versionCode=23 versionName=2.4.2). ✅ Migration `0026_protect_permanent_owner.sql` APPLIED to remote (`migration list` shows 0026 local↔remote). Nothing pending.**

### Permanent-Owner Protection — what shipped (2026-07-05)
Absolute, server-enforced protection of the single permanent OWNER (= immutable `developer_accounts`
allowlist via `is_developer`/`is_owner`, 0005+0013 — never a client-writable value).
- **Backend `0026_protect_permanent_owner.sql` (APPLIED):** new `_guard_protect_owner(target)` raises
  for ANY caller (owner included) when target is an owner. Added up-front to EVERY destructive RPC:
  `admin_set_account_status`, `admin_verify_user`, `admin_force_logout`, `admin_delete_account`,
  `admin_set_role`, `admin_revoke_premium`. Bodies reproduced faithfully from 0013/0025; only the
  guard added. `admin_set_role` still rejects any role but 'user'/'moderator' and never downgrades an
  existing admin row. Additive + idempotent (CREATE OR REPLACE only, no data changes). Result: owner
  cannot be banned/suspended/disabled/locked/force-logged-out/deleted/demoted/role-changed/
  un-verified/premium-revoked through API / RPC / DB / manipulated frontend. Non-owner→owner already
  blocked by 0013 `_guard_owner_target` (covers moderator-touches-owner). Normal user management
  unchanged (guard only fires on owner targets).
- **UI (already in tree, verified):** owner self = read-only "Owner account — protected" card and ALL
  management controls removed — mobile `AdminUserDetailScreen.tsx` (`{!protectedOwner && …}`) + web
  `AdminUsers.tsx` (`protectedOwner`, disabled fieldsets). No "Assign Admin" anywhere.
- **Settings role visibility (verified):** Admin dashboard row = OWNER only (`getServerOwner`);
  Moderator dashboard row = OWNER + moderators (`getServerModerator`, true for owner); normal users
  see neither — mobile `SettingsScreen.tsx`, web `SettingsModal.tsx`. Server RPC values, not client.
- **Nav/deep-link defense:** `AdminDashboardScreen`/`ModeratorDashboardScreen` re-check server-side
  and render "You don't have … access" when unauthorized; every admin data RPC self-gates via
  `_require_admin`/`_require_owner`/`_require_moderator_or_admin`, so a forced-nav user gets nothing.

### Verified (v2.4.2)
- ✅ Mobile `npx tsc --noEmit` EXIT 0 · ✅ Web `npm run build` clean.
- ✅ Migration `0026` applied (remote list = 0026); `_guard_protect_owner` on all 6 destructive RPCs.
- ✅ APK 2.4.2 (versionCode 23) built + copied to Desktop; aapt confirms version.
- ✅ No residual "Assign Admin" / `adminSetRole(...,'admin')`; `adminSetRole` typed 'user'|'moderator'.

---

## Previous checkpoint
**🟢 Admin System Cleanup (single permanent owner/admin) — SHIPPED. Mobile `tsc` EXIT 0, web `npm run build` clean. Version 2.4.1 (versionCode 22). ✅ APK BUILD SUCCESSFUL (3m22s, ~123 MB) → `~/Desktop/FUTUREHAT-2.4.1.apk`. Nothing pending.**

### Admin System Cleanup — what shipped (2026-07-05)
Enforce a SINGLE permanent owner/admin; remove every "Assign Admin" path (UI + shared API).
Backend was ALREADY enforced by migration `0025` (applied): `admin_set_role` rejects any role
except 'user'/'moderator', the Owner is admin via `is_owner()`/developer allowlist independent of
`profiles.role`, and an existing admin row can't be downgraded via that RPC. This checkpoint
removes the now-dead client surface:
- **`shared/adminApi.ts`**: `adminSetRole` type narrowed `Exclude<PlatformRole,'owner'>` →
  `'user' | 'moderator'` (admin no longer a valid argument, compile-time enforced); dropped the
  now-unused `PlatformRole` import; comment updated.
- **`mobile/src/screens/admin/AdminUserDetailScreen.tsx`**: removed the "Assign Admin" ActionBtn +
  "Only the Owner can manage Admins" hint. `adminSetRole(...,'user')` (Demote) + moderator
  assign/remove unchanged. `isOwner` still used (premium lifetime + owner-guard).
- **`web/src/admin/AdminUsers.tsx`**: removed the "Assign Admin" button + hint. Demote/moderator
  actions unchanged.
- **Untouched (correctly):** Community/group participant role `'admin'` (`ParticipantRole =
  'member'|'admin'`) is a per-group role, NOT platform admin — left intact. Moderator system
  unchanged. Role-badge reads (`['moderator','admin','owner']`) are display-only. "Admin dashboard"
  nav in Settings is owner-gated by AdminGate (opens the panel, doesn't assign admin).
- No new migration needed — `0025` already forbids assigning 'admin' server-side.

### Verified
- ✅ Mobile `npx tsc --noEmit` EXIT 0 · ✅ Web `npm run build` clean.
- ✅ No residual admin-assignment refs (`adminSetRole(...,'admin')` / "Assign Admin" gone).
- ⏳ APK 2.4.1 (versionCode 22) rebuild running → `~/Desktop/FUTUREHAT-2.4.1.apk`.

---

## Previous checkpoint
**🟢 Notification System (WhatsApp-quality, Mobile + Web) — SHIPPED. Mobile `tsc` EXIT 0, web `npm run build` clean. Version 2.4.0 (versionCode 21). ✅ APK BUILD SUCCESSFUL (3m34s, ~123 MB) → `~/Desktop/FUTUREHAT-2.4.0.apk`. ✅ Migration `0025` APPLIED to remote. Nothing pending (killed-state FCM push is an optional future add — see gaps).**

### Notification System — what shipped (2026-07-05)
Full WhatsApp-style notification stack across mobile + web + shared, per the two-part spec
(full channels/settings/actions + the revised "use DEVICE SYSTEM DEFAULT sound, NO picker,
no extra native modules"). Behaviour = WhatsApp defaults.

**Mobile** (all new/edited, `tsc --noEmit` EXIT 0):
- `mobile/src/lib/notifications.ts` (NEW): 6 Android channels (messages, group_messages, calls,
  missed_calls, status, admin_system) each with own importance/vibration/LED/`sound:'default'`
  (= device system default) + badge; channels versioned via `CHANNELS_VERSION` in AsyncStorage
  so they are NOT recreated every launch. Action categories: message (Reply text-input /
  Mark-read / Open), call (Accept / Decline). `registerForPush()` → `getDevicePushTokenAsync()`
  (raw FCM token) → `registerPushToken` RPC; sets `pushActive`. `presentMessageNotification`
  (grouped per chat via stable `chat:<id>` id), `presentCallNotification` (MAX priority, calls
  channel), clear helpers.
- `mobile/src/components/NotificationsBridge.tsx` (NEW): mounted once for signed-in users; inits
  channels + registers push; when push NOT active runs a realtime `messages` INSERT notifier
  (covers app open/background/minimised — the revised spec's required states); honours
  mute/preview/group settings; routes taps + Reply/Mark-read/Open actions; skips the open chat.
- `mobile/src/screens/NotificationsScreen.tsx` (EDITED): WhatsApp layout — MESSAGE (Mute,
  Notification tone→"Default (System)", Vibrate, Popup, High priority, Preview), CALLS
  (Ringtone→"Default (System)", Vibrate, Full-screen, Flash), STATUS (Mute), GROUPS (Mute,
  Tone, Vibrate). Tone rows open Android's per-channel settings (native customization, no
  in-app picker). Instant local-cache paint + synced load.
- `mobile/App.tsx`: mounts `<NotificationsBridge navRef={navRef}/>` for signed-in users.

**Shared** (NEW):
- `shared/notificationsApi.ts`: `NotificationSettings` defaults (tone/ringtone = `'default'`),
  get/set over `user_preferences.extra.notifications` (synced → restore on any device),
  `toneLabel()` → "Default (System)" | "Custom".
- `shared/pushApi.ts`: `registerPushToken`/`removePushToken` (RPC), `sendPush` (invokes the
  `push` Edge Function — see gap below), `SendPushArgs`/`PushKind`.
- `shared/types.ts`: `NotificationSettings` interface + `PushKind`.

**Web** (parity, `npm run build` clean):
- `web/src/lib/webNotifications.ts` (NEW): Notification API — message + call notifications,
  `ensurePermission()`, click-to-focus + open-chat callback, mute/preview honoured, per-chat
  `tag` collapse, only notifies when tab hidden/unfocused (WhatsApp Web parity), OS/browser
  default sound (no bundled sound).
- `web/src/lib/WebNotificationsBridge.tsx` (NEW): realtime `messages` notifier, synced settings.
- `web/src/settings/NotificationSettingsModal.tsx` (EDITED): settings UI parity.

**Backend** — `supabase/migrations/0025_notifications_and_single_owner.sql` (NEW, 114 lines):
`device_push_tokens` (own-rows RLS), `register_push_token`/`remove_push_token` RPCs, a
member-gated helper returning other members' tokens for a conversation. (Also folds in the
single-permanent-owner change: `admin_set_role` can no longer assign 'admin'.) **NOT applied to
remote yet** — needs the DB password.

### Verified
- ✅ Mobile `npx tsc --noEmit` EXIT 0.
- ✅ Web `npm run build` clean (tsc + vite).
- ✅ Packaged **release** AndroidManifest contains `POST_NOTIFICATIONS` (merged from the
  expo-notifications library manifest) — notifications work on Android 13+ WITHOUT a prebuild
  regen. Confirmed in `android/app/build/intermediates/merged_manifest/.../AndroidManifest.xml`.
- ⏳ APK 2.4.0 (versionCode 21) release build running via existing Gradle flow (no prebuild
  --clean — preserves the known-good Android build; android/ is gitignored CNG).

### Known gaps (deliberate — flagged, not silently skipped)
- **Killed-state FCM push NOT operational**: no `google-services.json` and the `push` Edge
  Function is NOT deployed (only `supabase/functions/ai` exists). `getDevicePushTokenAsync()`
  throws without FCM config → caught → app falls back to the local realtime notifier (open/
  background/minimised only). The revised spec scoped delivery to those 3 states, so this does
  NOT block the release. To enable killed-state later: add `google-services.json`, deploy a
  `push` Edge Function (FCM v1), (iOS also needs APNs key).
- **Full-screen incoming-call notification** (WhatsApp-style): needs native full-screen-intent /
  ConnectionService — deliberately NOT added (user said "no extra native modules"). Current
  incoming-call UX = in-app realtime call screen + a MAX-priority call notification.
  `USE_FULL_SCREEN_INTENT` is in app.json but absent from the built manifest (unused).
- **Sender photo as notification large-icon**: expo-notifications can't load a remote avatar as
  largeIcon without native work — omitted.
- **FCM token auto-refresh listener** (`addPushTokenListener`) not wired — minor; token is
  re-registered on each app launch via `registerForPush()`.

### Remaining for this feature (RESUME HERE)
1. ✅ **APK 2.4.0 built** (BUILD SUCCESSFUL 3m34s, versionCode 21, ~123 MB) → `~/Desktop/FUTUREHAT-2.4.0.apk`.
2. ✅ **Migration 0025 APPLIED** to remote (pooler `aws-1-ap-northeast-2`, `--include-all`);
   `migration list` shows 0025 local↔remote. `device_push_tokens` + RPCs live.
3. ⬜ Optional live on-device: send message app-open/background/minimised → notification with
   default sound + Reply/Mark-read/Open; toggle Mute/Preview; incoming call notification.
4. ⬜ Optional (killed-state): add `google-services.json` + deploy `push` Edge Function.

---

## Previous checkpoint
**🟢 Calls Module (WhatsApp-style, Mobile + Web parity) — CODE COMPLETE + migration 0024 APPLIED. APK 2.3.0 shipped.**

### Calls Module — what shipped (2026-07-04)
Rebuilt ONLY the Calls section to WhatsApp parity on both platforms; WebRTC calling stack
untouched. Fixed the core bug where mobile showed `caller_id` (yourself) for outgoing calls.
- **Migration `0024_calls_module.sql`** (applied via pooler `aws-1-ap-northeast-2`,
  `--include-all`; `migration list` shows 0024 local↔remote). `call_log_deletions` (per-user
  delete-for-me, mirrors `deleted_conversations`), `scheduled_calls` (member read / organizer
  manage, realtime), RPCs `get_call_history(limit,before)` (viewer-relative peer + direction,
  excludes deleted, paginated), `delete_call_logs(ids[])`, `clear_call_log()`. New tables on realtime.
- **Shared** (`types.ts`, `callsApi.ts`, new `callSettingsApi.ts`): `CallHistoryItem`/`CallGroup`/
  `ScheduledCall`/`CallSettings`; `getCallHistoryV2`, `deleteCallLogs`, `clearCallLog`,
  `subscribeCallChanges`, `groupCalls`, scheduled-call fns; call settings over `extra.calls`.
- **Mobile**: rewrote `CallsScreen` (grouping "Name (n)", direction+voice/video icons, WA
  timestamps, long-press multi-select + action bar, overflow menu, instant search, empty state +
  FAB contact picker, realtime, pagination) + new `CallDetailScreen`/`ScheduledCallsScreen`/
  `CallSettingsScreen`, registered in App/nav. `tsc --noEmit` EXIT 0.
- **Web**: new `calls/CallsView.tsx` (+`Calls.css`) from a sidebar phone icon — full parity incl.
  detail/scheduled/settings sub-panels. `npm run build` clean.
- **Delete semantics**: per-user hide — your delete/clear never affects the peer; only call rows
  are touched (chats/contacts/messages untouched). Scheduled Calls + Call Settings are functional.
- **Version** 2.2.0 → **2.3.0** (versionCode 19 → 20) across app.json / both package.json /
  build.gradle / both branding.ts.

### Remaining for this feature
- ✅ Release APK 2.3.0 (versionCode 20) BUILD SUCCESSFUL (3m48s) → `~/Desktop/FUTUREHAT-2.3.0.apk`.
- Optional (not yet run): live on-device — place voice+video calls → verify history/direction/
  grouping → select+delete / clear → schedule a call → toggle call settings. Verified so far by
  build + typecheck + remote migration check (code inspection), not a live device run.

---

## Previous checkpoint
**🟢 Moderator System (Phase 1) — CODE COMPLETE + migration 0023 APPLIED. APK 2.2.0 shipped.**

### Moderator System — what shipped (2026-07-04)
Full production surround around the already-functional role machinery, Mobile + Web parity:
- **Migration `0023_moderator_system.sql`** (applied via pooler `aws-1-ap-northeast-2`,
  `--include-all`; `migration list` shows 0023 local↔remote). Extends `user_warnings` into a
  user **mailbox** (`kind`/`title`/`reason`); adds report **escalation** columns; new RPCs
  `issue_warning`, `assign_moderator`/`remove_moderator` (modular admin-gated entry point —
  future auto-assignment calls the SAME fn), `mod_escalate_report`, `my_mailbox`(+unseen count
  + mark-seen), admin-only `admin_moderator_audit`; re-created `admin_list_reports` to expose
  `target_type` + escalation + resolve profile-report reporter. `user_warnings` → realtime.
- **Shared** (`types.ts` + `adminApi.ts`): `WARNING_REASONS`, `MailboxItem`, `ModeratorAuditEntry`,
  `AdminReport` +target_type/escalated; wrappers `assignModerator`/`removeModerator`/`issueWarning`/
  `escalateReport`/`getMyMailbox`/`getMailboxUnseenCount`/`mark*MailboxSeen`/`moderatorAuditLog`.
- **Web**: `moderator/ModeratorDashboard.tsx` (+css) — Reported Messages + Reported Profiles +
  the 5 actions (Review / Issue Warning / Close-No-Violation / Close-Violation / Escalate) +
  warning modal; `Mailbox.tsx`; AdminUsers Assign↔Remove swap w/ confirm; AdminDashboard
  **Mod Audit** tab; SettingsModal Mailbox (all users + unseen badge) + Moderator links + MOD
  badge; ContactProfileModal MOD badge; App wiring. `npm run build` clean.
- **Mobile**: `ModeratorDashboardScreen` + `MailboxScreen` (registered in App/nav types),
  SettingsScreen rows + MOD badge, AdminUserDetail Assign↔Remove swap + header MOD badge,
  ProfileScreen shield badge; **fixed** AdminDashboardScreen report-status to route through the
  audited `adminSetReportStatus` RPC. `tsc --noEmit` EXIT 0.
- **Version** 2.1.4 → **2.2.0** (versionCode 18 → 19) across app.json / both package.json /
  build.gradle / both branding.ts.
- **Permissions**: moderators structurally cannot ban/suspend/delete/grant-premium/manage-roles
  (those stay `_require_admin`/`_require_owner` server-side and are absent from moderator UI).
  Moderator audit is immutable (append-only `audit_log`, admin-visible only).

### Remaining for this feature
- ✅ Release APK 2.2.0 (versionCode 19) BUILD SUCCESSFUL (3m39s) → `~/Desktop/FUTUREHAT-2.2.0.apk`.
- Optional (not yet run): live on-device end-to-end — assign → moderator dashboard → issue
  warning → user mailbox → remove → admin Mod-Audit tab. Verified so far by build + typecheck
  + remote migration check (code inspection), not a live device run.

---

## Previous checkpoint
**🟠 Moderator System (Phase 1) — PLANNING (exploration complete, no code written).**

### Current feature
Admin-driven Moderator System, production-ready, modular for FUTURE auto-assignment
(Hall of Legends etc.) — NO auto-assignment this phase.

### Key finding (reshapes Phase 1)
"Assign Moderator" is **ALREADY functional**, not a placeholder — web
`web/src/admin/AdminUsers.tsx:157-163` and mobile
`mobile/src/screens/admin/AdminUserDetailScreen.tsx:160-171` both call
`adminSetRole(client, userId, 'moderator')` → RPC `admin_set_role`
(`supabase/migrations/0013_owner_admin.sql:344-361`), which updates `profiles.role` and
writes an audit row. Phase 1 adds the missing surround: confirm dialog + Remove-Moderator
swap, moderator badge, Moderator Dashboard (does not exist), structured warnings, user
mailbox UI (does not exist), audit surfacing. See IMPLEMENTATION_TODO.md CP-M0..CP-M9.

### Completed checkpoints
- Prior release: v2.1.4 Disappearing messages — SHIPPED (0022 applied, APK on Desktop). Detail below.
- Moderator **CP-M0**: exploration of admin/roles, reports/audit, mailbox — DONE.

### Remaining checkpoints
CP-M1 migration 0023 · CP-M2 shared API · CP-M3 web · CP-M4 mobile · CP-M5 badge ·
CP-M6 mailbox notifications · CP-M7 permissions hardening · CP-M8 build/version · CP-M9 verify.
(Full detail in IMPLEMENTATION_TODO.md.)

### Repository state
Branch `parity/web-mobile-2026-07`; last commit `7ab05e3`. Large UNCOMMITTED working tree
(Status v2.1.2 + Disappearing v2.1.4). No moderator code yet.

### Files modified / created (Moderator feature): NONE yet (only these 3 tracking files).

### Database migrations
Created + applied: 0020, 0021, 0022. Highest = 0022. Next moderator migration = **0023** (NOT created).
Pending migrations: none.

### Known issues
- Disappearing messages (v2.1.4) not yet live-tested end-to-end (verified by code inspection).
- No user-facing mailbox/inbox UI exists (`user_warnings` written, never displayed).
- Mobile admin report status update bypasses the audit RPC (direct table write, `AdminDashboardScreen.tsx:84-86`).
- Supabase pooler host = `aws-1-ap-northeast-2` (NOT `aws-0-...`). DB password is user-provided per session, never persisted.

### Next exact task
Produce the full Moderator implementation plan, then implement **CP-M1: migration 0023** —
moderator badge/dashboard support, extend `user_warnings` (kind/title/reason), user mailbox
read RPC + insert-on-appoint/remove, structured `issue_warning`, immutable moderator audit
surfacing (reuse append-only `audit_log` + `_audit()`).

### Reusable pieces (from exploration)
- Roles: `profiles.role` ('user','moderator','admin','owner') + `is_moderator/is_admin/is_owner`
  + `_require_admin/_require_owner/_require_moderator_or_admin` + `_audit()` (all `0013_owner_admin.sql`).
- Reports: `reports` table (0008/0017; target_type user|message|…, status open|reviewing|resolved|dismissed) +
  RPCs `admin_list_reports` / `admin_set_report_status` / `admin_warn_user` / `admin_reports_pending_count`; web `AdminReports.tsx`.
- Mailbox seed: `user_warnings` (0017: user_id, message, report_id, created_by, seen_at) written by `admin_warn_user`
  (`_require_moderator_or_admin`-gated) — but NO read API / UI yet.
- Badge pattern: web `web/src/premium/PremiumBadge.tsx`; mobile `Ionicons` star in `ProfileScreen.tsx:192`.

---
## Previous checkpoint
**✅ v2.1.4 SHIPPED — Disappearing messages (WhatsApp-style, per-chat, 1–8h). Migration 0022 applied + verified on remote; shared/mobile/web code complete; web build + mobile tsc clean; APK v2.1.4 (versionCode 18) BUILD SUCCESSFUL → `~/Desktop/FUTUREHAT-2.1.4.apk`. Nothing pending.**

### What shipped (v2.1.4)
- **Migration 0022** applied via pooler `aws-1-ap-northeast-2` (Seoul, new numbering; old `aws-0-...` string is stale). Verified: 0022 remote in `supabase migration list`. Objects: `conversations.disappear_seconds` (0=off else 3600..28800 + CHECK), `messages.expires_at`, BEFORE-INSERT trigger `trg_set_message_expiry`, RPCs `set_disappearing(conv,secs)` (member-gated) + `purge_expired_messages()`.
- **shared/types.ts**: `Conversation.disappear_seconds?`, `Message.expires_at?`.
- **shared/api.ts**: `getMessages` excludes expired via `.or(expires_at.is.null,expires_at.gt.now)`; new `setConversationDisappearing`, `getDisappearing`, `purgeExpiredMessages`, helpers `messageExpired` + `nextMessageExpiry`.
- **Mobile** `ChatScreen.tsx`: timeline filter `!messageExpired(m, now)` + single self-rescheduling expiry timer + purge on load. `ProfileScreen.tsx`: "Disappearing messages" Section (Off / 1–8h) via a bottom-sheet Modal → `setConversationDisappearing`, loads current via `getDisappearing`.
- **Web** `ChatView.tsx`: `displayMessages` filter + expiry timer + purge on load. `ContactProfileModal.tsx`: `<select>` Off/1–8h (+`.contact-disappear*` CSS) → same API.
- Version bumped 2.1.3 → **2.1.4** (versionCode 17 → 18) across app.json, both package.json, build.gradle.

---
## Previous in-progress note (superseded)
**🟡 v2.1.4 was IN PROGRESS — Disappearing messages. Migration written, code NOT started. Session paused (user swapping API key).**

### Feature spec (confirmed with user)
WhatsApp-style disappearing messages, PER-CHAT. Timer selectable **1–8 hours** only.
**On/off toggle lives in the contact's profile screen** (mobile `ProfileScreen`,
web `ContactProfileModal` — both already receive `conversationId`). **Default OFF.**
Approach CHOSEN by user = **DB-backed** (clean/robust). User will provide DB creds.

### RESUME HERE — exact next steps (in order)
1. **Apply migration** `supabase/migrations/0022_disappearing_messages.sql` (ALREADY WRITTEN, not yet applied).
   - Project ref: `toscljrivrawvlfebdzz` (region was Seoul / ap-northeast-2 per CP1 notes).
   - **Ask the user for the DB password again** (do NOT persist it). Then push, e.g.:
     `supabase db push --db-url "postgresql://postgres.toscljrivrawvlfebdzz:<PW>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" --include-all`
     (0022 sorts before the applied `20240102000000_add_message_reactions` migration, so `--include-all` is needed — same as CP1/0021.)
   - Verify: `conversations.disappear_seconds`, `messages.expires_at`, trigger `trg_set_message_expiry`, RPCs `set_disappearing` + `purge_expired_messages`.
2. **shared/types.ts**: add `disappear_seconds?: number` to `Conversation`; add `expires_at?: string | null` to `Message`.
3. **shared/api.ts**:
   - `getMessages`: exclude expired → add `.or(\`expires_at.is.null,expires_at.gt.${new Date().toISOString()}\`)`.
   - Add `setConversationDisappearing(client, convId, seconds)` → `rpc('set_disappearing', { conv, secs })`.
   - Add `getDisappearing(client, convId)` → select `disappear_seconds`.
   - Add `purgeExpiredMessages(client)` → `rpc('purge_expired_messages')`.
   - Add helper `messageExpired(m, now)` + optional `nextMessageExpiry(list)` (mirror status `pruneExpiredGroups`).
   - NOTE: `sendMessage` needs NO change — trigger stamps `expires_at`; `.select().single()` returns it.
4. **Mobile** `ChatScreen.tsx`: in `timeline` useMemo filter add `&& !messageExpired(m, now)`; add a `now` tick state + timer scheduled to soonest `expires_at` (reuse the StatusStrip expiry-timer pattern); call `purgeExpiredMessages` in load. `ProfileScreen.tsx`: add "Disappearing messages" row (Off / 1h..8h picker) → `setConversationDisappearing`; load current via `getDisappearing`.
5. **Web** `ChatView.tsx`: `displayMessages` filter add `&& !messageExpired(m, now)` + timer; purge on load. `ContactProfileModal.tsx`: same toggle UI.
6. Typecheck/build: web `npm run build`, mobile `npx tsc --noEmit`.
7. **Version bump 2.1.3 → 2.1.4** (versionCode 17 → 18) in app.json, both package.json, android/app/build.gradle. Build APK (`npm run build:release`), copy to `~/Desktop/FUTUREHAT-2.1.4.apk`.

### Design notes (already baked into 0022)
- `disappear_seconds` 0=off else 3600..28800; CHECK constraint enforces range.
- `messages.expires_at` stamped by BEFORE INSERT trigger from conversation setting
  → per-message snapshot (changing timer never re-times old messages = WhatsApp parity).
- `set_disappearing` is member-gated (uses existing `is_member(conv)` from 0001).
- `purge_expired_messages` scoped to caller's own conversations; clients also hide
  expired instantly + reuse is nothing-special (hard delete, FK on reply_to = set null).
- NOT modifying messages SELECT RLS (lower risk); client filter + query filter + purge suffice.

---
## Previous release
**✅ v2.1.3 — Instagram-style "Unsend" (mobile + web parity). SHIPPED, APK on Desktop.**
Feature: message-level "Delete for everyone" renamed to **Unsend**; an unsent message
now VANISHES completely on all connected devices (no "This message was deleted"
tombstone), Instagram-style — live via the existing realtime UPDATE.
- Reuses existing `deleteMessage` (soft-delete UPDATE: is_deleted=true, content/media
  nulled). NO schema change, NO new realtime channel.
- Vanish = filter `is_deleted` out of the render list on both platforms:
  - mobile `ChatScreen.tsx` `timeline` filter (`!hiddenIds && !is_deleted`)
  - web `ChatView.tsx` `displayMessages` filter (`!hiddenMsgIds && !is_deleted`)
- Chat-list preview: `shared/api.ts getMyConversations` last-message subquery now
  `.eq('is_deleted', false)` so the list shows the last REAL message (no deleted preview).
- Labels: mobile action-sheet + bulk → "Unsend"; web action menu → "Unsend".
- Untouched: delete-for-me, conversation-level delete-for-everyone, reply-preview,
  messaging/calls/status/etc.
- Verified: web `npm run build` clean; mobile `tsc --noEmit` EXIT 0.
- Version bumped 2.1.2 → **2.1.3** (versionCode 16 → 17) in app.json, both package.json,
  android/app/build.gradle.
✅ APK v2.1.3 (versionCode 17) BUILD SUCCESSFUL (3m44s) → copied to `~/Desktop/FUTUREHAT-2.1.3.apk`. Done, nothing pending.

### Prior release
**✅ v2.1.2 — WhatsApp-style Status (CP0–CP6 complete).**
Release APK: `mobile/android/app/build/outputs/apk/release/app-release.apk`
(was versionCode 16 / 2.1.2, BUILD SUCCESSFUL).

### Prior note (CP5 detail, retained)
**CP5 — realtime / performance pass done.**
- Client-side 36h expiry timers: `pruneExpiredGroups` in both `statusData` helpers;
  strips schedule a single self-rescheduling timer to the next-soonest `expires_at`
  (no polling, no refetch) — mobile + web.
- Subscriptions optimized: `subscribeStatusChanges` is now ONE ref-counted shared
  `status-changes` channel per client (was a fresh channel per caller) with a 250 ms
  DEBOUNCE so bursty INSERT/DELETE echoes coalesce into a single reload. Returns an
  `{ unsubscribe }` handle; both strips updated (was `removeChannel`).
- Viewer keeps its per-status `status-views:<id>` channel (only one viewer open at a
  time) — no duplicate-topic risk.
- Verified: mobile `tsc --noEmit` EXIT 0; web `npm run build` clean (tsc + vite).
- Versions already aligned at **2.1.2 / versionCode 16** (app.json, both package.json,
  android/app/build.gradle).
Next (CP6 remaining): confirm release APK 2.1.2 generated, then final summary.

## Feature summary
Enhance existing Status feature to WhatsApp parity across mobile + web: relocate to a
horizontal strip on the home screen, add audio (record + upload), captions & text styling,
**server-enforced** privacy (Everyone / Contacts / Except / Only), 36h lifetime, improved
viewer, live view tracking, and realtime — reusing existing tables/API/auth/storage.

Key confirmed decisions:
- **Contact** = users who share a `type='direct'` conversation. Blocked users always excluded.
- Delivery order: backend + shared → mobile UI → web parity.
- Audio: record (expo-av / MediaRecorder) **and** file upload, both platforms.

## Checkpoint sequence
- CP0 tracking files ✅
- CP1 migration `0021` (+ push) ✅
- CP2 shared types/API/privacy/upload ✅
- CP3 mobile UI (3a tab removal, 3b strip, 3c viewer+audio, 3d composer+record, 3e audience) ✅
- CP4 web parity (4a strip, 4b viewer/composer, 4c audience) ✅
- CP5 realtime/perf pass ✅
- CP6 full build + verification + rebuild mobile ✅ (web build clean, mobile tsc clean, APK 2.1.2 built)

## Completed tasks
- Explored existing Status system across mobile, web, shared, DB (no code changed).
- Approved implementation plan.
- Created tracking files (this file + IMPLEMENTATION_TODO.md).

## Remaining tasks
See `IMPLEMENTATION_TODO.md` for the checkbox breakdown.

## Files modified (this project)
- `PROJECT_PROGRESS.md` (new)
- `IMPLEMENTATION_TODO.md` (new)
- CP2 shared: `shared/types.ts`, `shared/api.ts`, `shared/privacyApi.ts`, `mobile/src/lib/media.ts`
- CP3 mobile (new): `mobile/src/components/status/{statusData,StatusStrip,StatusViewer,StatusComposer,AudiencePicker}.tsx`
- CP3 mobile (edited): `mobile/App.tsx` (Status tab removed), `mobile/src/screens/ConversationsScreen.tsx` (strip mounted)
- CP3 mobile (deleted): `mobile/src/screens/StatusScreen.tsx`
- CP4 web (new): `web/src/status/{statusData.ts,AudiencePicker,StatusViewer,StatusComposer,StatusStrip}.tsx` + `status.css`
- CP4 web (edited): `web/src/App.tsx` (strip mounted; header Status button + StatusView modal removed)
- CP4 web (deleted): `web/src/StatusView.tsx` (retired; `StatusView.css` kept, re-used by `status.css`)

## Database migrations
- Created: `supabase/migrations/0021_status_media_privacy.sql`.
- **Pushed + verified on remote** (session pooler, Seoul, via `--include-all` since 0021
  sorts before the already-applied reactions migration). Verified: 4 new columns, audio in
  type check, 36h default, `status_audience` table, `_are_contacts`/`_can_view_status`/
  `purge_expired_statuses` functions, rewritten read policy.
- Pending push: _none_.
- Note: remote migration history in sync through `0021` + reactions.

## Manual steps required
- Optional (production): schedule `select public.purge_expired_statuses();` via pg_cron
  for physical cleanup of expired rows (RLS already hides them; realtime DELETE drops them live).

## Final release summary (2026-07-04)
**FUTUREHAT 2.1.2 — WhatsApp-style Status (Mobile + Web parity): SHIPPED.**
- Status relocated to a horizontal strip on the home/Chats screen (mobile + web);
  dedicated Status tab/screen removed.
- Media: text (custom color), photo, video, audio (record + file upload) — both platforms.
- Privacy enforced server-side via RLS: Everyone / Contacts / Except / Only-share-with,
  with per-status audience snapshots. Blocked users always excluded. (migration 0021)
- 36h lifetime: server RLS hides expired + client-side timers prune at `expires_at`.
- Viewer: auto-advancing bars, tap/hold/swipe nav, mute, captions, next-media preload,
  reply-as-DM, delete-own, live "seen by" via realtime `status_views`.
- CP5 perf: single ref-counted + debounced `status-changes` realtime channel per client;
  no duplicate subscriptions; lazy next-image preload only.
- Builds verified: web `npm run build` clean (tsc + vite); mobile `tsc --noEmit` EXIT 0;
  Android release **BUILD SUCCESSFUL** → `app-release.apk` v2.1.2 (versionCode 16).

## Safe to resume: YES (project complete — nothing left to do)
