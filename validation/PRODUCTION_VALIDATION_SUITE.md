# Lumixo Production Validation Suite — Full Catalog

**Version:** 1.0 · **App:** Lumixo 4.6.0+ · **Platforms:** Android primary · Web regression secondary  

**Case ID format:** `DOMAIN-NNN`  
**Pass criteria:** Expected result met · no crash · no silent data loss · no PII leak in logs  

---

## How to use each case

| Field | Description |
|-------|-------------|
| **Preconditions** | Setup before steps |
| **Steps** | Ordered actions |
| **Expected** | Observable success |
| **Failure conditions** | Explicit fail modes |
| **Priority** | P0 / P1 / P2 |
| **Automation** | Auto / Semi / Manual |
| **☐** | Pass/Fail checklist |

---

# 1. Authentication

### AUTH-001 — Email sign up (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Fresh install; valid unused email |
| **Steps** | 1. Open app → Sign up 2. Enter name, email, password (≥6) 3. Submit |
| **Expected** | Account created; lands in main tabs; profile has display name |
| **Failure** | Crash; stuck spinner; silent fail; wrong screen |
| **Automation** | Manual (needs real Supabase Auth) |
| **☐ Pass** **☐ Fail** **Notes:** ________ |

### AUTH-002 — Email sign in (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Existing account |
| **Steps** | 1. Sign in with correct credentials 2. Kill app 3. Relaunch |
| **Expected** | Session restored without re-login |
| **Failure** | Forced login every launch; blank splash forever |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### AUTH-003 — Wrong password (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Valid email |
| **Steps** | Sign in with wrong password |
| **Expected** | Clear error; no navigation to Main; password not logged |
| **Failure** | Crash; “success” with empty session |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### AUTH-004 — Password reset link (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Account exists; `EXPO_PUBLIC_SITE_URL` is production host (not localhost) |
| **Steps** | 1. Forgot password 2. Submit email 3. Open email link on device |
| **Expected** | Opens ResetPassword; can set new password; can sign in with new password |
| **Failure** | Link opens web dead-end; localhost redirect; expired with no UX |
| **Automation** | Semi (`authLinks.test.ts` guards redirect construction) |
| **☐ Pass** **☐ Fail** |

### AUTH-005 — Sign out clears push token (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Signed in; push registered |
| **Steps** | 1. Settings → Sign out 2. Confirm 3. Send message to that user from another device |
| **Expected** | Signed out; next user on phone does not get previous user’s pushes |
| **Failure** | Ghost notifications for previous account |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### AUTH-006 — MFA enroll/verify if enabled (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Account Security → 2SV available |
| **Steps** | Enroll TOTP → verify code → lock session → re-auth |
| **Expected** | Enrollment succeeds; invalid code rejected |
| **Failure** | Locked out with no recovery path |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### AUTH-007 — Session refresh after long background (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Signed in; wait until near JWT expiry or force 1h+ background |
| **Steps** | Return to app; send a message |
| **Expected** | Auto refresh; send succeeds without forced re-login |
| **Failure** | 401 loops; infinite splash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 2. Messaging (1:1)

### MSG-001 — Send text (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Users A,B; direct chat open |
| **Steps** | A types message → Send |
| **Expected** | Optimistic bubble; clock → single ✓; B receives realtime; push if B killed |
| **Failure** | Duplicate bubbles; stuck pending forever online; crash |
| **Automation** | Semi (outbox offline suite) |
| **☐ Pass** **☐ Fail** |

### MSG-002 — Double-tap send does not duplicate (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Chat open; draft ready |
| **Steps** | Rapid double-tap Send / double Enter |
| **Expected** | Exactly one message |
| **Failure** | Two identical messages |
| **Automation** | Manual (guard is unit-level via code review + manual) |
| **☐ Pass** **☐ Fail** |

### MSG-003 — Reply (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Existing message |
| **Steps** | Swipe/long-press → Reply → type → send |
| **Expected** | Quote preview; bubble shows reply quote; peer sees reply |
| **Failure** | Wrong message quoted; reply lost offline |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-004 — Edit own text (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Own text message |
| **Steps** | Long-press → Edit → save |
| **Expected** | Content updates; “edited” marker; peer updates live |
| **Failure** | Can edit peer messages; no marker |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-005 — Delete / unsend (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Own message |
| **Steps** | Delete for everyone / for me as available |
| **Expected** | Correct tombstone or removal per product rules |
| **Failure** | Peer still has content after unsend-for-everyone |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-006 — Forward (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Message + ≥1 other chat |
| **Steps** | Forward → multi-select chats → Send |
| **Expected** | Forwarded tag; lands in all targets |
| **Failure** | Missing chats; crash on empty selection |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-007 — Reactions (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Message visible |
| **Steps** | Long-press → quick react 👍; open full emoji → react 🔥; tap pill to toggle off |
| **Expected** | Counts update live both sides; no premium lock on emoji |
| **Failure** | Stuck sheet; crash; reaction only local |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-008 — Read receipts (P0 · Manual)

| | |
|--|--|
| **Preconditions** | A sends; B opens chat |
| **Steps** | Observe ticks on A |
| **Expected** | ✓ → ✓✓ read (blue) when B opens |
| **Failure** | Never advances; marks read without open |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-009 — Typing indicator (P1 · Manual)

| | |
|--|--|
| **Preconditions** | A,B chat open |
| **Steps** | A types; B watches header |
| **Expected** | “typing…” appears; clears ~4s after stop |
| **Failure** | Stuck typing forever |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-010 — Scheduled message (P1 · Manual · Premium)

| | |
|--|--|
| **Preconditions** | Premium/owner; typed draft |
| **Steps** | Attach → Schedule → pick future time → confirm; wait |
| **Expected** | Sends at/after due; appears for peer |
| **Failure** | Never sends (dispatch not running) |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MSG-011 — Character limit (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Chat open |
| **Steps** | Paste >16k characters → send |
| **Expected** | Rejected with error; no partial corrupt row |
| **Failure** | Server 500; app crash |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

### MSG-012 — System messages not forgeable (P0 · Semi)

| | |
|--|--|
| **Preconditions** | API access with user JWT |
| **Steps** | Attempt insert `type=system` as client |
| **Expected** | Rejected by API/RLS |
| **Failure** | System message appears from client |
| **Automation** | Semi (`db-verify-authz` if configured) |
| **☐ Pass** **☐ Fail** |

---

# 3. Groups

### GRP-001 — Create group (P0 · Manual)

| | |
|--|--|
| **Preconditions** | ≥2 contacts |
| **Steps** | New group → name → members → create |
| **Expected** | Group appears for all members |
| **Failure** | Creator only; empty list |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-002 — Admin-only send (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Group with “admins only” send permission |
| **Steps** | Member tries to send |
| **Expected** | Blocked with clear alert |
| **Failure** | Member can send |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-003 — Add/remove members (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Admin of group |
| **Steps** | Add member; remove member |
| **Expected** | Membership updates; removed stops receiving |
| **Failure** | Ghost membership |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-004 — Leave group (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Member |
| **Steps** | Group info → Exit |
| **Expected** | Left; no further messages |
| **Failure** | Still receives push |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-005 — Invite link (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Admin; invite enabled |
| **Steps** | Copy link → open on other account |
| **Expected** | Join succeeds |
| **Failure** | Expired/revoked link still works |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-006 — Pin message (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Admin with pin permission |
| **Steps** | Pin/unpin message |
| **Expected** | Pinned UI updates for members |
| **Failure** | Non-admin can pin when disallowed |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### GRP-007 — Clear chat for me (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Group with history |
| **Steps** | Clear chat for me |
| **Expected** | Local clear; others retain history |
| **Failure** | Wipes for everyone |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 4. Communities

### COM-001 — Create community (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Signed in |
| **Steps** | Communities → New → name + icon |
| **Expected** | Community created; visible in list |
| **Failure** | RLS error; crash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### COM-002 — Channel message (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Community with channel |
| **Steps** | Post in channel |
| **Expected** | Members see update; announcement kind behaves per rules |
| **Failure** | Non-members can post |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### COM-003 — Events + RSVP (P2 · Manual)

| | |
|--|--|
| **Preconditions** | Community event |
| **Steps** | Create event; RSVP |
| **Expected** | Event listed; RSVP saved |
| **Failure** | Silent fail |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 5. Calls (voice / video)

### CALL-001 — Same-network voice call (P0 · Manual)

| | |
|--|--|
| **Preconditions** | A,B same Wi‑Fi; app open |
| **Steps** | A starts voice call; B accepts |
| **Expected** | Ring; accept; bidirectional audio <5s; hangup ends both |
| **Failure** | Stuck Connecting; one-way audio; crash |
| **Automation** | Semi (`scripts/call-test` signaling) |
| **☐ Pass** **☐ Fail** |

### CALL-002 — Cross-network call with TURN (P0 · Manual)

| | |
|--|--|
| **Preconditions** | TURN env set; A Wi‑Fi, B cellular |
| **Steps** | Video or voice call end-to-end |
| **Expected** | Connects via relay if needed; media works |
| **Failure** | Hang Connecting without TURN warning |
| **Automation** | Manual (requires real TURN) |
| **☐ Pass** **☐ Fail** |

### CALL-003 — Decline (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Incoming ring |
| **Steps** | B declines |
| **Expected** | A ends; no stuck Ringing; tray cleared |
| **Failure** | Infinite ring |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### CALL-004 — Missed call (P0 · Manual)

| | |
|--|--|
| **Preconditions** | B does not answer ~60s |
| **Steps** | Wait timeout |
| **Expected** | Missed status; missed notification for B; A not stuck |
| **Failure** | Call stuck ringing forever |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### CALL-005 — Accept from notification (P0 · Manual)

| | |
|--|--|
| **Preconditions** | B app backgrounded; incoming call notif |
| **Steps** | Tap Accept on notification |
| **Expected** | WebRTC session starts as callee (not status-only) |
| **Failure** | DB accepted but no media/UI (regression of acceptCallById) |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### CALL-006 — Single tray entry (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Backgrounded B |
| **Steps** | A calls B |
| **Expected** | One call notification (not two) |
| **Failure** | Duplicate notifs |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### CALL-007 — Mute / speaker / camera toggle (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Active video call |
| **Steps** | Toggle mute, speaker, video, flip camera |
| **Expected** | Instant effect; peer hears/sees change |
| **Failure** | Dead controls; black video |
| **Automation** | Semi (call-test controls) |
| **☐ Pass** **☐ Fail** |

### CALL-008 — Busy decline when already in call (P1 · Manual)

| | |
|--|--|
| **Preconditions** | A in call; C calls A |
| **Steps** | Observe A auto-decline C |
| **Expected** | C gets declined; A primary call uninterrupted |
| **Failure** | Two concurrent call UIs |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### CALL-009 — No TURN warning (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Build without TURN env |
| **Steps** | Start call |
| **Expected** | Confirm dialog about weak setup |
| **Failure** | Silent hang |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 6. Notifications & push

### NOTIF-001 — Foreground message suppressed for open chat (P0 · Manual)

| | |
|--|--|
| **Preconditions** | A has chat with B open and focused |
| **Steps** | B sends message |
| **Expected** | No banner for that chat; message appears in thread |
| **Failure** | Banner + sound while reading |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### NOTIF-002 — Background / killed delivery (P0 · Manual)

| | |
|--|--|
| **Preconditions** | B force-stops or kills Lumixo; FCM configured |
| **Steps** | A sends |
| **Expected** | High-priority FCM; tray shows; open deep-links to chat |
| **Failure** | No notif when killed |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### NOTIF-003 — Multi-device clear (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Same account on 2 devices |
| **Steps** | Read chat on device 1 |
| **Expected** | Tray clears on device 2 (`clear_chat` / receipts) |
| **Failure** | Ghost badges |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### NOTIF-004 — Mute conversation (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Chat muted |
| **Steps** | Peer sends |
| **Expected** | No local/push noise (respect mute) |
| **Failure** | Still notifies |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### NOTIF-005 — Notification actions Reply / Mark read (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Message notif visible |
| **Steps** | Reply from tray; Mark as read |
| **Expected** | Message sent / chat marked read; tray clears |
| **Failure** | No-op; crash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### NOTIF-006 — Outbox drain on resume (P1 · Semi)

| | |
|--|--|
| **Preconditions** | Pending push outbox rows |
| **Steps** | Foreground app |
| **Expected** | Drain invoked; pending jobs deliver |
| **Failure** | Stuck forever without cron |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

---

# 7. Media

### MED-001 — Send photo (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Gallery permission |
| **Steps** | Gallery → pick → quality → send |
| **Expected** | Optimistic preview; upload; peer sees image; type `image` |
| **Failure** | Stuck pending; 403 on open |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MED-002 — Send video as video type (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Short video |
| **Steps** | Pick video → send |
| **Expected** | Stored as `video` (not file); bubble shows video tile |
| **Failure** | Document bubble for video |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MED-003 — Media viewer swipe photo/video (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Chat with photo + adjacent video |
| **Steps** | Open photo; swipe to video; back to photo |
| **Expected** | Video audio only on active page; no ghost audio on photo |
| **Failure** | Photo opens with video audio (regression) |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MED-004 — Viewer after background (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Video open in viewer |
| **Steps** | Background app → resume |
| **Expected** | Player remounts; can play again |
| **Failure** | Dead player |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MED-005 — Quality tiers (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Large photo |
| **Steps** | Send Standard vs HD vs Original |
| **Expected** | File size/meta differ; all open |
| **Failure** | Quality ignored (cosmetic only) |
| **Automation** | Semi (`qualityEstimate.test.ts`) |
| **☐ Pass** **☐ Fail** |

### MED-006 — Upload size limits (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Free vs premium account |
| **Steps** | Try file > free limit |
| **Expected** | Clear upgrade/limit alert; no partial upload |
| **Failure** | Server 413 with no UX |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MED-007 — Save / share / forward from viewer (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Non–view-once media |
| **Steps** | Save; share; forward |
| **Expected** | Gallery save / share sheet / forward sheet work |
| **Failure** | Permission crash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 8. View Once

### VO-001 — Recipient one open (P0 · Manual)

| | |
|--|--|
| **Preconditions** | A sends view-once photo to B |
| **Steps** | B opens once; leave; try again |
| **Expected** | First open works; second blocked; spent UI |
| **Failure** | Unlimited reopens |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### VO-002 — Offline fail-closed (P0 · Manual)

| | |
|--|--|
| **Preconditions** | View-once unopened; airplane mode |
| **Steps** | B taps open |
| **Expected** | Error alert; media **not** revealed |
| **Failure** | Opens without server consume |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### VO-003 — Sender can re-view (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Sender’s own view-once |
| **Steps** | Open multiple times |
| **Expected** | Allowed for sender |
| **Failure** | Sender locked out |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### VO-004 — No save/share (P0 · Manual)

| | |
|--|--|
| **Preconditions** | View-once open |
| **Steps** | Attempt save/share |
| **Expected** | Blocked with message |
| **Failure** | Saved to gallery |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 9. Stories / Status

### ST-001 — Post text/image/video/audio status (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Signed in |
| **Steps** | Post each type |
| **Expected** | Appears in strip; expires per rules |
| **Failure** | Crash on post; invisible to self |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ST-002 — View peer status + viewers (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Peer posted status |
| **Steps** | View; check viewers on own |
| **Expected** | Progress bars; mute; next; view count for mine |
| **Failure** | Hang on audio; double audio |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ST-003 — Reply to status (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Peer status open |
| **Steps** | Reply text |
| **Expected** | Opens/sends DM with reply context |
| **Failure** | Silent fail |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ST-004 — Delete own status (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Own status |
| **Steps** | Delete |
| **Expected** | Removed for viewers |
| **Failure** | Ghost status |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 10. File sharing

### FILE-001 — Send document (P0 · Manual)

| | |
|--|--|
| **Preconditions** | PDF/DOC < limit |
| **Steps** | Attach document → send |
| **Expected** | File bubble; open/share works; not treated as video |
| **Failure** | 403 open; wrong mime |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### FILE-002 — Offline document queue (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Airplane mode |
| **Steps** | Send document; go online |
| **Expected** | Queued then uploads; peer receives |
| **Failure** | Silent drop (pre-4.6.0 bug class) |
| **Automation** | Semi (outbox suite covers structure) |
| **☐ Pass** **☐ Fail** |

---

# 11. Search

### SRCH-001 — Chat list search (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Multiple chats |
| **Steps** | Type name in list search |
| **Expected** | Filters chats; message hits when ≥2 chars |
| **Failure** | Crash on special chars |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SRCH-002 — In-chat search (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Long thread |
| **Steps** | Search → next/prev matches |
| **Expected** | Highlights; jumps; no filter-away whole thread incorrectly |
| **Failure** | Wrong match index |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SRCH-003 — User search New Chat (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Other users exist |
| **Steps** | Search username ≥2 chars |
| **Expected** | Results; self excluded |
| **Failure** | Unhandled rejection blank state |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SRCH-004 — Emoji search (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Emoji picker open |
| **Steps** | Search “love”, “lol”, “fire” |
| **Expected** | Relevant glyphs; Recent updates |
| **Failure** | Empty always |
| **Automation** | Semi (keyword map unit-testable) |
| **☐ Pass** **☐ Fail** |

---

# 12. Offline mode & local cache

### OFF-001 — Open chats offline (P0 · Auto+Manual)

| | |
|--|--|
| **Preconditions** | Previously synced account; airplane mode |
| **Steps** | Launch app; open chat list; open thread |
| **Expected** | Cached list + messages render; no crash |
| **Failure** | Blank forever; crash |
| **Automation** | **Auto** `scripts/offline-test` |
| **☐ Pass** **☐ Fail** |

### OFF-002 — Compose offline → auto-send (P0 · Auto+Manual)

| | |
|--|--|
| **Preconditions** | Offline |
| **Steps** | Send text; re-enable network |
| **Expected** | Outbox flush once; single delivery; pending clears |
| **Failure** | Lost message; duplicates |
| **Automation** | **Auto** offline-test #7 |
| **☐ Pass** **☐ Fail** |

### OFF-003 — Outbox max attempts dead-letter (P1 · Auto)

| | |
|--|--|
| **Preconditions** | Poison outbox item |
| **Steps** | Flush repeatedly |
| **Expected** | After max attempts removed; no infinite battery spin |
| **Failure** | Infinite retries |
| **Automation** | **Auto** / code contract |
| **☐ Pass** **☐ Fail** |

### OFF-004 — Drafts survive kill (P0 · Auto+Manual)

| | |
|--|--|
| **Preconditions** | Type draft; kill app |
| **Steps** | Relaunch → same chat |
| **Expected** | Draft restored; not bled into other chats |
| **Failure** | Wrong chat draft |
| **Automation** | **Auto** offline-test drafts + Manual race |
| **☐ Pass** **☐ Fail** |

### OFF-005 — Corrupt cache degrades (P0 · Auto)

| | |
|--|--|
| **Preconditions** | Corrupt AsyncStorage entry |
| **Steps** | Read cache |
| **Expected** | Empty fallback; no throw |
| **Failure** | Crash loop |
| **Automation** | **Auto** offline-test #9 |
| **☐ Pass** **☐ Fail** |

### OFF-006 — Action queue offline pin/mute (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Offline |
| **Steps** | Pin/mute/archive; go online |
| **Expected** | Optimistic UI holds; server catches up; no pop-back |
| **Failure** | UI flips then reverts permanently wrong |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

### OFF-007 — Concurrent outbox safety (P0 · Manual/Semi)

| | |
|--|--|
| **Preconditions** | Online |
| **Steps** | Rapid multi-media send + text |
| **Expected** | All items persist; none dropped (outbox lock) |
| **Failure** | Missing messages |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

---

# 13. Database consistency & RLS

### DB-001 — Block enforcement (P0 · Manual/Semi)

| | |
|--|--|
| **Preconditions** | A blocks B |
| **Steps** | B tries message/call |
| **Expected** | Blocked by RLS/API |
| **Failure** | Messages still deliver |
| **Automation** | Semi (`db-verify-authz`) |
| **☐ Pass** **☐ Fail** |

### DB-002 — Subscription client cannot self-grant (P0 · Semi)

| | |
|--|--|
| **Preconditions** | Free user JWT |
| **Steps** | Direct write to `subscriptions` / free activate path |
| **Expected** | Denied; client activate disabled |
| **Failure** | Free premium |
| **Automation** | **Auto** `premiumLock.test.ts` + Manual API probe |
| **☐ Pass** **☐ Fail** |

### DB-003 — Message type constraint (P0 · Semi)

| | |
|--|--|
| **Preconditions** | User JWT |
| **Steps** | Insert invalid type / system |
| **Expected** | Rejected |
| **Failure** | Forged system messages |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

### DB-004 — Starred / receipts RLS (P1 · Semi)

| | |
|--|--|
| **Preconditions** | Two users |
| **Steps** | Attempt cross-user star/receipt forge |
| **Expected** | RLS deny |
| **Failure** | Cross-user writes |
| **Automation** | Semi `db-verify-starred` |
| **☐ Pass** **☐ Fail** |

### DB-005 — Migrations applied (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Production project |
| **Steps** | Verify 0031 video type, 0042 subscription lock, 0043–0047 push, blocks |
| **Expected** | All critical migrations present |
| **Failure** | Features silently broken |
| **Automation** | Semi `db-precheck` / dashboard |
| **☐ Pass** **☐ Fail** |

---

# 14. Background sync

### SYNC-001 — NetInfo reconnect flush (P0 · Auto)

| | |
|--|--|
| **Preconditions** | Offline outbox items |
| **Steps** | Emit online |
| **Expected** | `flushOutbox` + `flushActions` run |
| **Failure** | Stuck until restart |
| **Automation** | **Auto** offline-test |
| **☐ Pass** **☐ Fail** |

### SYNC-002 — App foreground drain (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Backgrounded long |
| **Steps** | Resume |
| **Expected** | Push drain kick; badge refresh; token re-assert |
| **Failure** | Stale token forever |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SYNC-003 — Scheduled dispatch only in foreground (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Scheduled messages due |
| **Steps** | Keep app backgrounded; then open |
| **Expected** | Dispatch on open/active; no aggressive background poll |
| **Failure** | Battery drain interval in background |
| **Automation** | Manual / code review |
| **☐ Pass** **☐ Fail** |

---

# 15. Payment flow

### PAY-001 — Order amount matches plan (P0 · Semi)

| | |
|--|--|
| **Preconditions** | Razorpay keys live |
| **Steps** | create_order monthly/yearly |
| **Expected** | 2500 / 24900 paise |
| **Failure** | Wrong amount |
| **Automation** | Semi (edge logs) |
| **☐ Pass** **☐ Fail** |

### PAY-002 — Client cannot spoof yearly (P0 · Manual/Semi)

| | |
|--|--|
| **Preconditions** | Ability to intercept verify body |
| **Steps** | Pay monthly; send verify with plan=yearly |
| **Expected** | Plan from **amount** only → monthly; yearly rejected if amount mismatch |
| **Failure** | Yearly granted for monthly payment |
| **Automation** | Semi (edge function logic) |
| **☐ Pass** **☐ Fail** |

### PAY-003 — Invalid signature rejected (P0 · Semi)

| | |
|--|--|
| **Preconditions** | Edge deployed |
| **Steps** | verify with bad HMAC |
| **Expected** | 400; no activation |
| **Failure** | Activates anyway |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

### PAY-004 — Mobile free activate disabled (P0 · Auto)

| | |
|--|--|
| **Preconditions** | Source tree |
| **Steps** | `premiumLock.test.ts` |
| **Expected** | Free/manual activate paths absent/disabled |
| **Failure** | Self-grant UI |
| **Automation** | **Auto** |
| **☐ Pass** **☐ Fail** |

### PAY-005 — Premium features gate correctly (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Free vs premium user |
| **Steps** | Stickers, schedule, themes |
| **Expected** | Free sees upgrade; premium works |
| **Failure** | Free unlocks all |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 16. Admin features

### ADM-001 — Owner-only admin dashboard (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Non-owner user |
| **Steps** | Navigate to Admin if exposed |
| **Expected** | Denied |
| **Failure** | Full admin access |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ADM-002 — Ban user (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Owner admin |
| **Steps** | Ban test user |
| **Expected** | Banned user cannot use app; data consistent |
| **Failure** | Ban no-op |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ADM-003 — Delete message (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Admin tools |
| **Steps** | Delete message by id |
| **Expected** | Removed for all |
| **Failure** | Partial delete |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ADM-004 — App disable flag (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Owner |
| **Steps** | Disable app globally |
| **Expected** | Clients blocked with message |
| **Failure** | Users continue unaware |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### ADM-005 — Announcements (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Owner |
| **Steps** | Publish announcement |
| **Expected** | Clients show AdminGate banner |
| **Failure** | Crash on subscribe |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 17. Moderation

### MOD-001 — Report user/message/group (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Reporter + target |
| **Steps** | Report each type with reason |
| **Expected** | Stored; success UX; no crash |
| **Failure** | Silent fail |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MOD-002 — Moderator dashboard access (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Moderator role |
| **Steps** | Open moderator tools |
| **Expected** | Access granted; non-mod denied |
| **Failure** | Privilege escalation |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MOD-003 — Support ticket (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Signed in |
| **Steps** | Help → submit ticket |
| **Expected** | Ticket stored |
| **Failure** | Dropped |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 18. Account deletion

### DEL-001 — Request deletion (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Test account only |
| **Steps** | Account security → Delete → confirm |
| **Expected** | Request recorded; 30-day window messaging accurate |
| **Failure** | Immediate hard wipe without notice |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### DEL-002 — Purge worker (P1 · Semi)

| | |
|--|--|
| **Preconditions** | Due purge rows; service role |
| **Steps** | Run account-purge function/cron |
| **Expected** | Data purged per policy |
| **Failure** | Orphaned PII |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

### DEL-003 — Data export (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Account with data |
| **Steps** | Export data |
| **Expected** | JSON (or format) downloadable/shareable |
| **Failure** | Empty/corrupt export |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 19. Backup / restore

### BAK-001 — Local cache as soft backup (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Used app online |
| **Steps** | Offline after sync |
| **Expected** | Recent chats readable offline |
| **Failure** | Total data loss offline |
| **Automation** | Auto offline-test |
| **☐ Pass** **☐ Fail** |

### BAK-002 — Cloud backup (P2 · Manual)

| | |
|--|--|
| **Preconditions** | Feature if shipped |
| **Steps** | Backup / restore flow |
| **Expected** | Documented behavior |
| **Failure** | Claimed but unimplemented — mark N/A if not shipped |
| **Automation** | Manual / N/A |
| **☐ Pass** **☐ Fail** **☐ N/A** |

> Note: Full cloud backup is **not** a v4.6.0 flagship feature; treat as N/A unless product claims it.

---

# 20. Settings

### SET-001 — Theme light/dark/AMOLED (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Appearance screen |
| **Steps** | Switch each mode |
| **Expected** | Instant palette; readable contrast |
| **Failure** | Invisible text |
| **Automation** | Semi `theme-contrast.mjs` |
| **☐ Pass** **☐ Fail** |

### SET-002 — Privacy visibility (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Privacy settings |
| **Steps** | Change last seen / about visibility |
| **Expected** | Peer sees correct restriction |
| **Failure** | Always public |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SET-003 — Chat wallpaper (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Appearance |
| **Steps** | Set wallpaper |
| **Expected** | Chat background updates |
| **Failure** | Crash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SET-004 — App lock (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Device biometrics/PIN |
| **Steps** | Enable app lock; background; return |
| **Expected** | Lock screen; unlock works |
| **Failure** | Locked out; no lock |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SET-005 — Chat lock (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Device auth |
| **Steps** | Lock a chat; open |
| **Expected** | Gate; unlock session |
| **Failure** | Preview leak while locked |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SET-006 — Notification prefs (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Notifications settings |
| **Steps** | Toggle message/group mute globals |
| **Expected** | Respected by bridge/push |
| **Failure** | Ignored |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SET-007 — Clear cache (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Storage screen |
| **Steps** | Clear cache |
| **Expected** | Size drops; app still works; media re-fetchable |
| **Failure** | Crash; broken auth |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 21. Security

### SEC-001 — No secrets in APK strings (P0 · Semi)

| | |
|--|--|
| **Preconditions** | Release APK |
| **Steps** | Scan for service role key / Razorpay secret |
| **Expected** | Only anon + public keys |
| **Failure** | Service role in binary |
| **Automation** | Semi (scripted strings) |
| **☐ Pass** **☐ Fail** |

### SEC-002 — HTTPS only API (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Proxy |
| **Steps** | Observe traffic |
| **Expected** | TLS to Supabase; no plaintext secrets |
| **Failure** | HTTP credentials |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SEC-003 — Reset URL not localhost (P0 · Auto)

| | |
|--|--|
| **Preconditions** | CI |
| **Steps** | `authLinks.test.ts` |
| **Expected** | Pass |
| **Failure** | Localhost in production path |
| **Automation** | **Auto** |
| **☐ Pass** **☐ Fail** |

### SEC-004 — Deep link recovery only installs recovery session (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Malformed recovery URL |
| **Steps** | Open bad link |
| **Expected** | Safe error; no privilege escalation |
| **Failure** | Arbitrary session |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### SEC-005 — Blocked user cannot re-enter via group (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Policy as implemented |
| **Steps** | Validate product expectation documented |
| **Expected** | Matches RLS |
| **Failure** | Bypass via group |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 22. Performance

### PERF-001 — Chat list scroll (P0 · Manual)

| | |
|--|--|
| **Preconditions** | ≥100 chats |
| **Steps** | Fling scroll 10s |
| **Expected** | ~60fps feel; no multi-second freezes |
| **Failure** | Dropped frames constantly |
| **Automation** | Manual (profile with systrace optional) |
| **☐ Pass** **☐ Fail** |

### PERF-002 — Open chat cold (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Cached chat |
| **Steps** | Tap chat |
| **Expected** | First paint <300ms perceived from cache |
| **Failure** | Spinner >2s every time online |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### PERF-003 — Long-press menu latency (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Chat list |
| **Steps** | Long-press row |
| **Expected** | Sheet <100ms after gesture |
| **Failure** | Modal cold-start lag |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### PERF-004 — Message list 1000 msgs (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Large thread |
| **Steps** | Scroll history |
| **Expected** | Smooth inverted list |
| **Failure** | OOM / freeze |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### PERF-005 — Typecheck + unit tests (P0 · Auto)

| | |
|--|--|
| **Preconditions** | Repo checkout |
| **Steps** | `node scripts/run-validation-suite.mjs` |
| **Expected** | Exit 0 |
| **Failure** | Red CI |
| **Automation** | **Auto** |
| **☐ Pass** **☐ Fail** |

---

# 23. Battery usage

### BAT-001 — Idle background (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Android battery stats |
| **Steps** | Idle 1h background |
| **Expected** | No high “always running” alarms; no 60s chat interval in bg |
| **Failure** | Top battery hog idle |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### BAT-002 — Call adaptive stats interval (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Active call |
| **Steps** | Observe CPU; end call |
| **Expected** | Intervals stop after hangup |
| **Failure** | Timers leak after call |
| **Automation** | Semi (code cleanup verified) |
| **☐ Pass** **☐ Fail** |

### BAT-003 — Outbox not infinite retry (P0 · Semi)

| | |
|--|--|
| **Preconditions** | Dead-letter max |
| **Steps** | Poison item |
| **Expected** | Stops after MAX_OUTBOX_ATTEMPTS |
| **Failure** | Infinite network loop |
| **Automation** | Semi |
| **☐ Pass** **☐ Fail** |

---

# 24. Memory usage

### MEM-001 — Open/close 50 chats (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Profiler / Android Memory |
| **Steps** | Open/close 50 threads |
| **Expected** | No unbounded growth; GC recovers |
| **Failure** | OOM |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MEM-002 — Media viewer memory (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Album of large images |
| **Steps** | Swipe 30 media |
| **Expected** | Inactive videos unmounted; stable memory |
| **Failure** | OOM |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### MEM-003 — Audio message recycle (P1 · Semi)

| | |
|--|--|
| **Preconditions** | Many voice notes |
| **Steps** | Scroll list playing different notes |
| **Expected** | Previous sounds unload |
| **Failure** | Multiple audio streams |
| **Automation** | Semi (mounted guard) |
| **☐ Pass** **☐ Fail** |

---

# 25. Voice notes

### VN-001 — Hold to record (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Mic permission |
| **Steps** | Hold mic → release send; cancel gesture if supported |
| **Expected** | Audio message delivered |
| **Failure** | Stuck mic; empty audio |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### VN-002 — Offline voice (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Airplane mode |
| **Steps** | Record send; go online |
| **Expected** | Queued via outbox; delivers |
| **Failure** | Lost |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 26. Polls

### POLL-001 — Create and vote (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Chat |
| **Steps** | Create poll; vote both users |
| **Expected** | Live counts |
| **Failure** | Double-count bugs |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 27. Disappearing messages

### DIS-001 — Timer expiry (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Chat timer 1h (or testable short if available) |
| **Steps** | Send; wait expiry |
| **Expected** | Messages hide when expired |
| **Failure** | Never expire client-side |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

# 28. Streaks / mailbox

### STR-001 — Streak activity (P2 · Semi)

| | |
|--|--|
| **Preconditions** | Direct chat activity |
| **Steps** | Message both sides |
| **Expected** | Streak UI updates without spam mailbox |
| **Failure** | Mailbox flooded |
| **Automation** | Semi SQL/scripts |
| **☐ Pass** **☐ Fail** |

---

# 29. Cross-cutting regression (release)

### REG-001 — Fresh install happy path (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Clean install APK |
| **Steps** | Sign up → chat → media → call → settings → sign out |
| **Expected** | No crash end-to-end |
| **Failure** | Any P0 crash |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### REG-002 — Upgrade install (P0 · Manual)

| | |
|--|--|
| **Preconditions** | Previous version installed |
| **Steps** | Install 4.6.0+ over |
| **Expected** | Session preserved; outbox intact |
| **Failure** | Data wipe |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

### REG-003 — Web parity smoke (P1 · Manual)

| | |
|--|--|
| **Preconditions** | Web prod URL |
| **Steps** | Login; send to mobile; receive |
| **Expected** | Cross-client message works |
| **Failure** | One side never sees |
| **Automation** | Manual |
| **☐ Pass** **☐ Fail** |

---

## Coverage summary

| Domain | Cases (approx) | P0 count (approx) |
|--------|----------------|-------------------|
| Auth | 7 | 5 |
| Messaging | 12 | 8 |
| Groups | 7 | 4 |
| Communities | 3 | 0 |
| Calls | 9 | 6 |
| Notifications | 6 | 3 |
| Media | 7 | 3 |
| View Once | 4 | 3 |
| Status | 4 | 1 |
| Files | 2 | 2 |
| Search | 4 | 3 |
| Offline/cache | 7 | 5 |
| Database/RLS | 5 | 3 |
| Sync | 3 | 1 |
| Payments | 5 | 3 |
| Admin | 5 | 2 |
| Moderation | 3 | 1 |
| Account delete | 3 | 1 |
| Backup | 2 | 0 |
| Settings | 7 | 2 |
| Security | 5 | 3 |
| Performance | 5 | 3 |
| Battery | 3 | 2 |
| Memory | 3 | 0 |
| Voice | 2 | 2 |
| Polls / disappear / streaks | 3 | 0 |
| Regression | 3 | 2 |
| **Total** | **~130+** | **~70 P0** |

---

## Automation map (existing repo assets)

| Suite | Command | Covers |
|-------|---------|--------|
| Jest mobile | `cd mobile && npm test` | authLinks, premiumLock, time, qualityEstimate, mediaViewerMath |
| Offline | `node scripts/offline-test/...` via runner | cache, drafts, outbox, reconnect |
| Calls | call-test runner | signaling, watchdog, controls |
| Theme | `node scripts/theme-contrast.mjs` | contrast |
| DB | `scripts/db-verify*.mjs` | RLS (needs credentials) |
| Typecheck | `tsc` mobile/web | compile safety |
| Master | `node scripts/run-validation-suite.mjs` | all of the above |

---

## Definition of done for Play Store

1. All **P0** cases Pass (or documented Waived with owner sign-off).  
2. Automated runner green.  
3. `checklists/PLAY_STORE_GATE.md` complete.  
4. Two-device matrix complete.  
5. No open Sev-1 bugs.
