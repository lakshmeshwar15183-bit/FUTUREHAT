# WORK_LOG — Push Notifications (killed-state delivery)

Date: 2026-07-06
Branch: `parity/web-mobile-2026-07`

---

## Problem reported

- App **open** → incoming messages notify (with sound). ✅
- App **background / closed / killed** → **no** notification (unlike WhatsApp). ❌
- Conclusion from the reporter: the app relies on an in-app WebSocket listener, not
  real push. **Correct.**

---

## Root cause

The killed-state push path was **designed but never completed**. Three gaps, all of
which fail silently (every call is wrapped in try/catch that no-ops), so the feature
*looked* wired up but delivered nothing when the app wasn't running:

1. **The `push` Edge Function did not exist.** `shared/pushApi.ts → sendPush()` calls
   `supabase.functions.invoke('push', …)`. Only `supabase/functions/ai` existed, so the
   invoke 404'd and was swallowed. **No server-side push was ever sent.**
2. **FCM was never configured on the client build.** No `google-services.json`, and no
   `googleServicesFile` reference in the Expo config. So on device,
   `Notifications.getDevicePushTokenAsync()` throws → `pushActive` stays `false` → **no
   device token is registered** in `device_push_tokens`.
3. Because `pushActive` was `false`, `NotificationsBridge` fell back to a **realtime
   WebSocket** `postgres_changes` listener that presents a *local* notification. That JS
   only runs while the app process is alive (open / briefly backgrounded). Killed app →
   no JS → no WebSocket → no notification. **Exactly the reported symptom.**

The database layer (migration `0025`) was already correct and is unchanged.

---

## Architecture found

**Stack:** Supabase (Postgres + Edge Functions) · Web (Vite/React) · Mobile (Expo RN).

**Client (mobile):**
- `mobile/src/lib/notifications.ts` — Android channels, `registerForPush()` (requests
  `POST_NOTIFICATIONS`, gets the **raw FCM device token** via
  `getDevicePushTokenAsync()`, registers it), local notification presenters, tap/action
  routing helpers.
- `mobile/src/components/NotificationsBridge.tsx` — mounted for signed-in users; inits
  channels, registers the token, and (only when push is *not* active) runs the realtime
  local-notifier. Routes taps + Reply / Mark-read actions.
- `mobile/src/screens/ChatScreen.tsx` + `mobile/src/calls/CallContext.tsx` — call
  `sendPush()` after sending a message / starting a call.

**Shared:** `shared/pushApi.ts` (`registerPushToken` / `removePushToken` / `sendPush`),
`shared/notificationsApi.ts` (per-user notification settings in
`user_preferences.extra.notifications`).

**DB (migration `0025_notifications_and_single_owner.sql`):** `device_push_tokens` table
(own-rows RLS) + `register_push_token` / `remove_push_token` / `recipient_push_tokens`.

**Design intent (from code comments):** raw **FCM HTTP v1** — the client registers a raw
FCM token and a `push` Edge Function fans out via FCM v1. Only the function + native FCM
config were missing. This work **completes that existing design** (no client rewrite,
no switch to Expo Push Service).

---

## Files inspected

- `shared/pushApi.ts`, `shared/notificationsApi.ts`, `shared/premiumApi.ts` (prefs table)
- `mobile/src/lib/notifications.ts`, `mobile/src/components/NotificationsBridge.tsx`
- `mobile/src/screens/ChatScreen.tsx`, `mobile/src/calls/CallContext.tsx`,
  `mobile/src/screens/SettingsScreen.tsx`, `mobile/App.tsx`, `mobile/lib/shared.ts`
- `mobile/app.json`, `mobile/eas.json`, `mobile/package.json`
- `supabase/functions/ai/index.ts` (function conventions), `supabase/config.toml`
- `supabase/migrations/0025_…`, `0001_init.sql`, `0003_premium.sql`,
  `0027_chat_lock…` (locked_conversations)
- `web/src/lib/webNotifications.ts` (web path — see "Web" below)

---

## Files changed

**New**
- `supabase/functions/push/index.ts` — the missing FCM v1 fan-out Edge Function.
- `mobile/app.config.js` — dynamic Expo config that layers the native Firebase files
  onto `app.json` **only when present** (so the repo still builds before you add them).
- `WORK_LOG.md` — this file.

**Edited**
- `mobile/src/lib/notifications.ts`
  - Foreground handler is now **dynamic**: suppresses the banner/sound for the chat
    that's currently open (works for both local *and* remote FCM notifications).
  - `startPushTokenRefresh()` — re-registers on FCM **token rotation**
    (`addPushTokenListener`).
  - `unregisterForPush()` — drops the device token on sign-out.
  - Tracks `lastToken` for refresh/unregister.
- `mobile/src/components/NotificationsBridge.tsx` — starts token-refresh and cleans it up.
- `mobile/src/screens/SettingsScreen.tsx` — sign-out now calls `unregisterForPush()` first.
- `.gitignore` — ignore Firebase **service-account private keys** (never commit).
- `.env.example` — document `FCM_SERVICE_ACCOUNT` secret + client Firebase files.

_No unrelated features were touched. The realtime WebSocket messaging path is preserved._

---

## Push architecture implemented

**Delivery = FCM HTTP v1.** The recipient's OS displays the notification from the system
tray even when the app is **killed** (it's a remote FCM *notification* message — no JS
needed). Flow when a message is sent:

1. Message is saved normally (unchanged: optimistic insert + durable outbox).
2. Client fire-and-forgets `sendPush({ conversationId, kind, title, body })`.
3. `push` Edge Function (`verify_jwt`, so only a signed-in user can call it):
   - authenticates the caller with **their** JWT and confirms they are a **member** of
     the conversation (a user can only push into their own chats);
   - with the **service role**, loads the *other* members' registered device tokens,
     their per-user notification prefs (mute / preview), and chat-lock state;
   - **redacts per recipient** — muted → skipped (calls always ring); locked chat →
     `"FUTUREHAT" / "New message"`; preview off → `"New message"`; else sender name +
     preview. This mirrors the in-app realtime redaction, now enforced server-side so
     privacy is the *recipient's* setting, not the sender's;
   - mints an **FCM v1 OAuth token** from the service-account key (RS256 JWT →
     `oauth2.googleapis.com/token`, cached per worker until ~1 min before expiry);
   - sends one message per token, routed to the matching **Android channel**
     (`channel_id` + `sound: default`) and with APNs priority/sound for iOS;
   - **prunes** tokens FCM reports as `UNREGISTERED` / `NOT_FOUND` (expired/invalid).

**Requirement coverage**
- **Open / background / killed** — killed & background handled by FCM system-tray
  delivery; foreground handled by expo-notifications' handler (banner + sound).
- **Permission** — `registerForPush()` requests `POST_NOTIFICATIONS` (Android 13+).
- **Token registration** — `register_push_token` RPC on launch.
- **Token refresh** — `addPushTokenListener` re-registers on rotation.
- **Multiple devices per user** — table is keyed per token; fan-out hits all of them.
- **Invalid/expired tokens** — pruned on FCM `UNREGISTERED`/`NOT_FOUND`.
- **Duplicate prevention** — the realtime local-notifier is disabled on any device once
  its FCM token is registered (`isPushActive()`), so FCM and WebSocket never both fire;
  the open chat is suppressed in the foreground handler.
- **Sound** — device system default via the notification channel (nothing bundled).
- **Tap → correct chat** — FCM `data.conversationId` → existing response listener
  navigates to `Chat`.

**Real-time preserved** — the Supabase realtime messaging + the in-app foreground
notifier remain; push only *adds* killed/background delivery.

---

## Configuration / environment variables

**Edge Function secret (server only — the one real secret):**
```
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
```
(`project_id` is read from the key; the function no-ops with `{skipped:'push-not-configured'}`
if the secret is absent, so messaging keeps working before push is set up.)

**Client Firebase files (public config, auto-detected by `mobile/app.config.js`):**
- `mobile/google-services.json` (Android)
- `mobile/GoogleService-Info.plist` (iOS, optional)

Already present / unchanged: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (all auto-injected into Edge Functions),
`EXPO_PUBLIC_SUPABASE_*`.

---

## Tests performed (automated / static)

- `npx tsc --noEmit` on **mobile** → **passes clean** (exit 0), incl. the edited files.
- Manual review of `push/index.ts`: FCM v1 message shape, RS256 JWT signing via
  WebCrypto (`pkcs8` import), token caching, per-recipient redaction, `UNREGISTERED`
  pruning, and the membership auth gate.
- `deno check` was **not** run locally (Deno not installed on this machine); it runs
  automatically during `supabase functions deploy push`.

⚠️ End-to-end push (open / background / killed) **cannot** be verified from this
environment — it requires a real Firebase project, a device build with
`google-services.json`, and the deployed function. See the manual steps below, then run
the device test matrix in "Verification checklist".

---

## Setup progress (updated 2026-07-06, later session)

Firebase credentials were provided and wired up:
- ✅ Firebase project **`futurehat-473e2`** created; Android app `dev.lakshmeshwar.futurehat`.
- ✅ `google-services.json` placed at `mobile/google-services.json` (auto-detected by
  `app.config.js`); prebuild embedded it + applied the `com.google.gms.google-services`
  Gradle plugin.
- ✅ Service-account key **secured OUTSIDE the repo** at
  `~/.futurehat-secrets/fcm-service-account.json` (dir `700`, file `600`); `.gitignore`
  blocks `*firebase-adminsdk*.json` / `service-account*.json` as defense-in-depth
  (verified with `git check-ignore`).
- ✅ Migration `0025` verified applied on the live DB.
- ✅ **FCM-enabled 2.4.7 APK rebuilt** (versionCode 28), signed with the release key,
  firebase-messaging classes bundled → on the Desktop + `release/`.

- ✅ **`push` Edge Function deployed** + `FCM_SERVICE_ACCOUNT` secret set (via
  `scripts/deploy-push.sh` with a one-time Supabase access token).

### Pipeline verification (2026-07-07, automated from this machine)

Every server link was exercised without a physical device:

1. **Function deployed + JWT gate** — `POST /functions/v1/push` with no auth → `401`
   (gateway `verify_jwt`); with a valid anon JWT but no user → our code's
   `{"error":"Unauthorized"}` → confirms the deployed function is executing.
2. **DB layer** — `device_push_tokens` + `register_push_token` / `remove_push_token` /
   `recipient_push_tokens` confirmed present on the live DB.
3. **FCM credential chain** (the exact path the function uses, run against the secured
   service-account key):
   - OAuth token mint → `200`, access_token received ✅ (key valid, RS256 signing works)
   - FCM v1 `messages:send` (`validate_only:true`, fake token) → `400 INVALID_ARGUMENT`
     ✅ — credentials accepted, **FCM API enabled**, network path good (only the fake
     token was rejected; a bad key/disabled API would be `401/403`).
4. **Client** — 2.4.7 APK (versionCode 28) contains bundled firebase-messaging classes,
   `google-services.json` embedded, signed with the release key.

**Not machine-verifiable (requires a physical device):** a real device registering an
FCM token and the OS displaying the notification while the app is killed. That is the
manual test below — everything it depends on is green.

### How to install the new APK + killed-app end-to-end test

1. **Get the APK onto the phone** — it's at `~/Desktop/FUTUREHAT-v2.4.7.apk`. Either:
   - USB: `adb install -r ~/Desktop/FUTUREHAT-v2.4.7.apk`, or
   - transfer the file to the phone and tap it (allow "install unknown apps").
   This must be the **new** 2.4.7 (FCM) build — an older build won't register a token.
2. **First launch → grant the notifications permission** when prompted (Android 13+).
3. **Confirm the device registered** (optional): a row for this user appears in
   `device_push_tokens` (platform `android`).
4. **Killed-app test (the original bug):**
   - From a **second** account/device, open a chat with the test user — leave it ready.
   - On the test phone, **swipe FUTUREHAT out of recents** (fully killed, not just
     backgrounded).
   - From the second account, **send a message**.
   - ✅ Expected: within a few seconds the test phone shows a heads-up notification with
     the sender's name + preview and the default sound — **with the app killed**.
   - **Tap it** → the app opens directly to that chat.
5. **Also check:** background (home button) delivery; foreground with a *different* chat
   open (banner) vs. that chat open (no banner, message still arrives live); mute a chat
   → no notification (but calls still ring); sign out → token removed.

Troubleshooting: no notification when killed → confirm it's the new APK (Settings → Apps
→ FUTUREHAT → App info shows 2.4.7), notifications permission granted, and battery
optimization isn't force-stopping the app (some OEMs — Xiaomi/Oppo/Samsung — need
"Allow background activity" / "Autostart" enabled for reliable FCM wakeups).

---

## Original manual setup steps (for reference / reproducing on a new machine)

1. **Create a Firebase project** (or reuse one).
2. **Android app** in that project with package **`dev.lakshmeshwar.futurehat`** →
   download **`google-services.json`** → put it in the **`mobile/`** folder.
3. **(iOS, optional)** Add an iOS app (bundle **`dev.lakshmeshwar.futurehat`**), upload
   your **APNs key** in Firebase → Cloud Messaging, download
   **`GoogleService-Info.plist`** → put it in **`mobile/`**.
4. **Service-account key:** Firebase console → Project settings → Service accounts →
   *Generate new private key* → save the JSON **outside the repo**, then:
   ```
   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat /path/to/service-account.json)"
   ```
   Ensure the **Firebase Cloud Messaging API (v1)** is enabled for the project.
5. **Deploy the function:**
   ```
   supabase functions deploy push
   ```
6. ~~**Confirm migration `0025` is applied**~~ — ✅ VERIFIED applied on the live DB
   (2026-07-06): `device_push_tokens` + all three RPCs are present. Nothing to do.
7. **Rebuild the mobile app** so `google-services.json` is embedded
   (`eas build -p android` or `npx expo run:android`). The push path is inert on any
   build made before the file was added.

### Verification checklist (on-device, after the above)
- [ ] Fresh install → grant notifications → a row appears in `device_push_tokens`.
- [ ] **Foreground, different chat open** → banner + sound.
- [ ] **Foreground, that chat open** → no banner (suppressed), message still arrives live.
- [ ] **Background** → notification appears.
- [ ] **Killed (swiped away)** → notification appears. ← the original bug.
- [ ] Tap notification → opens the correct chat.
- [ ] Mute a chat → no notification for it; calls still ring.
- [ ] Second device on the same account → both receive.
- [ ] Sign out → token removed (no notifications for the next user on that phone).

---

## Web (not the reported platform — noted, not implemented)

`web/src/lib/webNotifications.ts` uses the browser Notification API and only fires while
the **tab is open** (same class of limitation as the mobile realtime path). True
"browser closed" web push needs a Service Worker + VAPID + Web Push subscriptions — a
separate effort. The `push` function and `device_push_tokens` already carry a
`platform='web'` value, so a future web-push worker can register against the same
backend. **Out of scope** for this fix, which targets the reported mobile behavior.

---
---

# WORK_LOG — Message long-press interaction (chat)

Date: 2026-07-07
Branch: `parity/web-mobile-2026-07`
Ships in: **2.4.8** (versionCode 29)

## Problem reported

Long-pressing a message bubble to open the actions / reaction menu was **slow,
delayed, inconsistent, or dead** — and **completely dead while the keyboard was
open / the composer was focused** (the user had to dismiss the keyboard first).

## Root cause (two independent defects in the gesture architecture)

**A. Keyboard-open dead zone — the real "doesn't work with keyboard up" cause.**
`ChatScreen`'s message `FlatList` had **no `keyboardShouldPersistTaps`**, so it used
the RN default `"never"`. With the soft keyboard up, a `ScrollView`/`FlatList`
**intercepts the first touch to dismiss the keyboard and never delivers it to its
children** — so the bubble never received the press and the long-press could not
start until the keyboard was already down. Exactly the reported symptom.

**B. Slow/inconsistent long-press — a two-gesture-system conflict.** The long-press
was an **RN `Pressable` `onLongPress`** (React Native's JS touch-responder system),
but every bubble is wrapped by `SwipeToReply`, which drives swipe with
**`react-native-gesture-handler` (`GestureDetector` + `Gesture.Pan`)** — a *separate,
native* gesture system. Two uncoordinated arbiters competed for the same touch: the
native Pan handler held the gesture "possible" while the JS long-press timer ran, so
on Android the long-press was frequently delayed or dropped. The tell-tale sign was
that `onLongPress` + `delayLongPress` had been **duplicated onto every nested
`Pressable`** (image, video, reply preview, and both audio-player controls) as a
band-aid to try to make "the whole bubble" long-pressable — fighting the symptom, not
the cause.

## Fix (unify the gesture into RNGH + let taps through while the keyboard is up)

1. **Long-press is now a native RNGH `Gesture.LongPress`** composed with the existing
   swipe `Gesture.Pan` in `SwipeToReply`, so **one native arbiter** coordinates
   long-press, swipe, and the list's vertical scroll — no JS-vs-native contention.
   - `minDuration(300)` — native-feeling hold (RN's default is a sluggish 500ms).
   - `maxDistance(10)` sits **below** the pan's `activeOffsetX(14)`, so the two have
     **disjoint activation regions** and never both fire: a still hold opens the menu;
     any real drag/scroll moves past 10px first, cancelling the hold and handing off
     to pan/scroll (so **scrolling never triggers an accidental long-press**).
   - Composed with `Gesture.Simultaneous` (not `Exclusive`) so the long-press timer
     isn't gated behind the pan failing.
   - `enabled(!!onLongPress)` keeps long-press working **in selection mode** (where
     swipe-to-reply is disabled) and inert on deleted messages.
2. **`keyboardShouldPersistTaps="handled"` on the message `FlatList`** — a long-press
   now lands **while the keyboard is open**; taps on empty list space still dismiss
   the keyboard. The keyboard is **not** force-dismissed on long-press (per the UX
   requirement).
3. **Removed the band-aid** duplicated `onLongPress`/`delayLongPress` from every nested
   `Pressable` in `MessageBubble` and both controls in `AudioMessage`. Taps (open
   image, jump-to-reply, scrub/seek audio, toggle-select) stay on those `Pressable`s;
   the single wrapper-level native long-press covers the entire bubble subtree.

## Files changed

- `mobile/src/components/SwipeToReply.tsx` — added `onLongPress` prop + `Gesture.LongPress`
  composed with the pan (`Gesture.Simultaneous`); `GestureDetector` now runs the composed gesture.
- `mobile/src/components/MessageBubble.tsx` — dropped `onLongPress`/`delayLongPress` from the
  outer + nested `Pressable`s and from `Props`; kept `onPress` + the press-scale visual.
- `mobile/src/components/AudioMessage.tsx` — dropped the forwarded `onLongPress` prop + its use.
- `mobile/src/screens/ChatScreen.tsx` — moved the long-press handler onto `SwipeToReply`
  (gated off for deleted messages); added `keyboardShouldPersistTaps="handled"` to the `FlatList`.

## Why this is the root-cause fix, not a workaround

No arbitrary delays were added and the keyboard is not auto-dismissed. The long-press
threshold is a normal 300ms. The change moves long-press into the **same** gesture
system that already reliably handles swipe on this exact detector (swipe-to-reply
works today → the detector demonstrably receives touches over the nested `Pressable`s),
and fixes the `ScrollView` tap-interception that specifically broke the keyboard-open
case.

## Tests performed

- `npx tsc --noEmit` (mobile) → **clean, exit 0**.
- `npx tsc --noEmit` (web) → **clean, exit 0** (no `shared/` or web files touched).
- Static trace of the event flow (documented above); build shipped in 2.4.8 for the
  on-device matrix below.

### On-device verification matrix (run on the 2.4.8 APK)

Because gesture/touch behaviour cannot be exercised from this machine, verify on the
installed 2.4.8 build — long-press should open the actions/reaction menu **quickly and
on the first attempt** in every cell:

- [ ] Keyboard **closed** + long-press — sent message.
- [ ] Keyboard **closed** + long-press — received message.
- [ ] Keyboard **open / composer focused** + long-press (the original failure) — menu
      opens **without** dismissing the keyboard first.
- [ ] **After scrolling** the thread + long-press — no accidental long-press *during*
      the scroll; a deliberate hold still opens the menu.
- [ ] Long-press on **image / video / voice / reply-quote** bubbles — all open the menu.
- [ ] **Swipe-to-reply still works** and does not co-fire the menu.
- [ ] **Selection mode**: long-press toggles selection; tap toggles selection.

## Scope / non-changes

No unrelated chat functionality was touched: send/receive, realtime, reactions,
reply/edit/delete/forward, media viewer, search, disappearing messages, and the
swipe-to-reply animation are all unchanged.

---
---

# WORK_LOG — Call Details screen (real per-call metadata)

Date: 2026-07-07
Branch: `parity/web-mobile-2026-07`
Ships in: **2.4.8** (versionCode 29)

## Problem reported

Tapping a call in the Calls history opened `CallDetailScreen`, but it showed only
**generic contact actions** (avatar, name, Voice/Video buttons, Contact info, Delete,
Block, Report) — **none of the actual call's metadata** (type, direction/status, date,
time, duration).

## Root cause

The metadata was **already stored and already delivered to the client** — the screen
just never rendered it. The `calls` table (`0006_calls.sql`) has `type`, `status`,
`started_at`, `answered_at`, `ended_at`, and `caller_id`; the `get_call_history()` RPC
(`0024_calls_module.sql`) returns each of those **plus** viewer-relative `direction`
(`CallHistoryItem`). But `CallsScreen` navigated to `CallDetail` passing **only the
contact** (`conversationId`, `peerId`, `title`, `username`, `avatarUrl`) — no call
record — and `CallDetailScreen` fetched nothing for display. So the screen had no call
data to show. **No schema change was needed** — the fix is to carry the real records
into the screen and render them.

## Duration — how it's calculated

A call is treated as **connected** iff it was **both answered and ended**
(`answered_at != null && ended_at != null`). Its duration is then

    duration = ended_at − answered_at    (talk time)

**never** measured from `started_at` (ring start). Calls that never connected show a
status instead of a bogus "0 sec":

| Real fields | Shown |
|---|---|
| answered + ended | `Outgoing/Incoming voice/video call` · date + time span · `Duration: …` |
| declined (not answered) | `Declined … call` · `Call declined` / `You declined` |
| outgoing, never answered | `Cancelled … call` · `No answer` |
| incoming, never answered | `Missed … call` · `No answer` |

Direction/status are **derived from the stored record** (`direction`, `answered_at`,
`ended_at`, `status`), so cancelled-vs-missed reads correctly per viewer even though
the backend never writes a literal `missed` status (an unanswered incoming call is
"Missed" for the callee, "Cancelled" for the caller). Duration is formatted cleanly:
`8 sec` · `1 min 24 sec` · `12 min 38 sec` · `1 hr 5 min 17 sec` — never raw seconds/ms.

## Offline-first behaviour

- **Instant render:** `CallsScreen` already holds the `CallHistoryItem` records in
  memory (loaded from the `'callHistoryV2'` AsyncStorage cache, then reconciled with
  the server). The tapped row's **exact** records are passed to `CallDetail` via the
  `calls` nav param, so the detail paints immediately with **no network wait / no
  spinner**.
- **Background reconcile:** `CallDetail` then refreshes from cache (deep-link fallback)
  and from `getCallHistoryV2`, **scoped to the tapped group's call ids** so metadata
  updates without expanding to the contact's entire history.
- **Delete = offline-first:** deleting removes the call(s) from the shared cache
  **immediately** (so the list reflects it on return) and syncs `deleteCallLogs` in the
  background; it now deletes **only the specific call(s)** in that history row.

## Separate records per call

Each history row keeps its own `callIds`; `CallDetail` renders every call in the tapped
group as its **own** entry (own type / direction / status / date / time / duration), so
multiple calls with the same person stay distinct — not merged into contact info.

## Files changed (mobile only — no schema, no shared/web changes)

- `mobile/src/navigation/types.ts` — `CallDetail` params gain optional
  `calls?: CallHistoryItem[]` (the tapped row's real records).
- `mobile/src/screens/CallsScreen.tsx` — pass the group's `CallHistoryItem[]` (filtered
  from the in-memory list by `callIds`) into `CallDetail` from both tap targets.
- `mobile/src/screens/CallDetailScreen.tsx` — new **"Call details"** section between the
  Voice/Video buttons and the actions group; `describeCall()` + `formatCallDuration()` +
  `formatCallDateTime()`; offline-first load/reconcile; delete now scoped + cache-first.

**No DB/schema change** — all fields already exist and are returned by
`get_call_history()`. **No lifecycle change** — `started_at`/`answered_at`/`ended_at`
are already recorded at initiate/accept/end, and duration is computed from them; adding
a literal `missed`/`cancelled` status write was intentionally **not** done (the display
derives it correctly and touching the call lifecycle would risk unrelated regressions).

## UI

Reuses the existing theme tokens (`useColors` palette, `spacing`/`radius`/`font`) and
the same `styles.group` card pattern already on the screen; adds a muted section label
and per-call rows with a type icon tinted `primary` (normal) or `danger` (missed/
declined). Light + dark + AMOLED all use the shared palette, so both modes stay
consistent. The rest of the screen is unchanged.

## Tests performed

- `npx tsc --noEmit` (mobile) → **clean, exit 0**.
- `npx tsc --noEmit` (web) → **clean, exit 0** (no shared/web files touched → iOS/Web
  shared code intact).
- Duration formatter checked against the required examples (8 sec / 1 min 24 sec /
  12 min 38 sec / 1 hr 5 min 17 sec).

### On-device verification matrix (run on the 2.4.8 APK)

- [ ] Outgoing **completed** call → `Outgoing voice/video call` + correct `Duration`.
- [ ] Incoming **completed** call → `Incoming …` + correct duration.
- [ ] **Missed** (incoming, unanswered) → `Missed … call` · `No answer` (no "0 sec").
- [ ] **Declined** → `Declined … call`.
- [ ] **Cancelled** (outgoing, unanswered) → `Cancelled … call` · `No answer`.
- [ ] **Voice vs video** render the right label + icon.
- [ ] **Multiple calls with the same person** in one row show as **separate** entries.
- [ ] Open a **cached** call detail with no network → renders immediately.
- [ ] **Delete** → row disappears immediately and stays gone after reopening Calls.

## Remaining limitations

- The backend never writes a literal `missed`/`cancelled` status and does no
  ring-timeout, so those states are **derived** (answered/ended/direction). If the app
  is killed **mid-call**, `ended_at` may be unset → that call reads as
  Cancelled/Missed rather than a completed call with duration. Making those states
  authoritative would need call-lifecycle changes (ring-timeout + a persisted duration)
  and was left out of scope to avoid touching the calling engine.

---
---

# WORK_LOG — Themes / Appearance screen overhaul

Date: 2026-07-07
Branch: `parity/web-mobile-2026-07`
Ships in: **2.4.8** (versionCode 29 — rebuilt in place, no version bump)

## Feedback

"The themes tab is not that good as expected." Confirmed the wanted direction: a **live
preview**, **better visual design**, **more themes/colors**, and **retuned base colors**.

## What was there

`AppearanceScreen` was a flat list of tiny static swatches (mode rows, 6 color-theme
chips, font/bubble/icon pills, wallpaper cells) with **no preview** of the result — you
picked blind. Colors + wallpaper apply live app-wide via `ThemeContext`; font/bubble/
icon persist to `user_preferences` (shared with web) but aren't yet rendered.

## Changes

1. **Live mock-chat preview (top of the screen).** A `ChatPreview` renders a real
   WhatsApp-style header + two message bubbles in the **currently-previewed** palette
   and wallpaper, updating **instantly** as you tap. Tapping a **premium-locked** theme
   or wallpaper **previews it without applying** (a golden "Preview only — unlock with
   FUTUREHAT+" bar appears, tap → Premium). Bubble radius in the preview follows the
   selected bubble style. Preview state resyncs to the applied theme on server reconcile.
2. **Redesigned pickers.** Mode is now a 2-up grid of cards each with a mini in/out-bubble
   swatch + selected ring; color themes and wallpapers are larger rounded tiles with a
   two-tone swatch, selected ring, an **applied** check and a lock badge; font/bubble are
   bordered pills with a lock glyph; app icons are bordered tiles with a lock badge.
   Consistent 1.5px selected rings, spacing, and a `sparkles` "FUTUREHAT+" section tag.
3. **More themes + wallpapers** (`theme/appearance.ts`). Color themes **6 → 12**: added
   **Ocean, Forest, Crimson, Slate, Latte, Bubblegum** (full hand-tuned palettes, dark
   variants, near-white text on-brand accents). Wallpapers **6 → 12**: added Ocean,
   Forest, Crimson, Latte, Slate, Plum tints.
4. **Retuned base palettes** (`theme/palettes.ts`). Dark mode got a slightly cooler,
   deeper base with **clearer elevation steps** (bg → surface → surfaceAlt) and a more
   defined border so cards/rows read as layered instead of flat; AMOLED surfaces got a
   touch more lift and a more visible border. Text/brand/bubble colors were left as-is
   (already WCAG-tuned), so contrast is unchanged app-wide.

## Files changed (mobile only)

- `mobile/src/screens/AppearanceScreen.tsx` — live `ChatPreview`, preview-on-tap
  (locked themes preview without applying), upsell bar, full picker redesign.
- `mobile/src/theme/appearance.ts` — +6 color themes, +6 wallpapers.
- `mobile/src/theme/palettes.ts` — dark + AMOLED elevation/border refinement.

## Web / shared parity

No `shared/` or `web/` files touched. Theme + wallpaper still persist to the shared
`user_preferences.theme` / `.wallpaper` columns; the new ids are mobile-only for now, so
web simply falls back to its default palette for them (graceful — no web break).

## Tests performed

- `npx tsc --noEmit` (mobile) → **clean, exit 0**.
- New palettes eyeballed for contrast (near-white body text on each dark base; accent on
  bubbleOut). Preview logic traced: locked themes preview but don't persist; applied
  check tracks the real `colorTheme`/`wallpaper`; preview resyncs on reconcile.

### On-device verification matrix (run on the rebuilt 2.4.8 APK)

- [ ] Tap each **mode / color theme / wallpaper** → the preview updates instantly.
- [ ] Tap a **locked premium** theme (free account) → preview changes, upsell bar shows,
      the rest of the app keeps the current theme (not applied).
- [ ] With **premium**, applying a theme/wallpaper updates the whole app + persists.
- [ ] **Applied** check sits on the currently-active theme/wallpaper.
- [ ] Dark / Light / AMOLED all look right in the preview and app.

## Remaining limitations

- **Font & bubble style** still persist but aren't rendered app-wide (pre-existing) — the
  preview reflects bubble radius, but real chat bubbles/fonts are unchanged until those
  prefs are wired into `MessageBubble` + a font loader. Out of scope for this pass.
- New themes/wallpapers are **mobile-only**; add matching entries to `web/src/theme` for
  full cross-platform parity later.
