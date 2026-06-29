# FUTUREHAT — Master feature checklist (non-negotiable)

Status legend: ✅ done · 🟡 in progress / app-side done, needs backend or infra ·
⬜ planned. "Web" = the deployed web app already covers it (also serves as the
desktop/PWA experience). Android app lives in `mobile/`.

## Support & Trust
- ✅ Grievance Redressal System (screen + policy + ticket) — mobile `HelpSupportScreen`
- ✅ Help Center — mobile Settings → Help & Support
- ✅ FAQ section — mobile `HelpSupportScreen`
- ✅ Contact Support (email + in-app ticket) — `submitTicket` via `supportApi`
- ✅ Report User / Report Message / Report Group/Channel — `submitReport` API (data layer)
- ✅ Appeal Account Ban — ticket kind `appeal`
- ✅ Feedback & Feature Request — ticket kind `feedback`
- ✅ Bug Report (with device/logs) — ticket kind `bug`, auto device info

## Safety & Privacy
- ✅ Privacy Center
- ✅ Terms of Service / Privacy Policy / Community Guidelines
- ✅ End-to-End Encryption information
- ✅ Block & Mute users — `blockUser` / `muteConversation` via `supportApi` (data layer)
- 🟡 Two-Factor Authentication (Supabase MFA enroll/verify)
- 🟡 Login history / Active devices / Session management (Supabase sessions)
- ✅ Download account data / Data export
- ✅ Delete account

## Account
- ✅ Edit Profile / Username / About / Profile picture
- ✅ Email verification · 🟡 Phone number · ✅ Change password
- ✅ QR Code profile
- 🟡 Verification badges · 🟡 Developer/Admin accounts (developer override exists)

## Chat
- ✅ Pin · 🟡 Archive · 🟡 Starred · ✅ Scheduled (shared API) · ✅ Edit · ✅ Delete
- ✅ Reply · ✅ Forward · ✅ Reactions · 🟡 Search · ✅ Voice notes
- ✅ Media gallery · ✅ Polls (create + live vote in chat) · 🟡 Pinned messages · 🟡 Disappearing messages

## Calls
- ✅ Voice / Video (WebRTC) · 🟡 Group calls · 🟡 Screen sharing
- 🟡 Picture-in-Picture (in-call PiP done; OS PiP pending) · ✅ Call history
- 🟡 Missed call notifications (needs push)

## Communities
- ✅ Communities / Channels / Events · ✅ Announcement & broadcast channel kinds · 🟡 Invite links / Join requests
- ✅ Groups with roles (admin/member) · ✅ Community admin roles (RLS-enforced)

## Contacts
- 🟡 Phone contacts sync · ✅ Add by username · 🟡 Add by QR
- 🟡 Suggested contacts · 🟡 Favorites

## Premium
- ✅ Subscription / Badge / Management (reuses premium system)
- 🟡 Referral rewards · 🟡 Gift Premium · ✅ Developer lifetime premium (override)

## Notifications
- 🟡 Push / Mention / Custom / Quiet hours / Categories (app-side settings done;
  delivery needs Expo push + FCM credentials)

## Storage
- ✅ Storage manager (cache size + clear) · 🟡 Media quality · 🟡 Auto-download

## Settings
- ✅ Dark/Light/AMOLED · 🟡 Font size · ✅ Chat wallpaper · 🟡 Language · 🟡 Accessibility

## Admin Panel
- 🟡 User management / Reports dashboard / Analytics / Moderation / Ban /
  Premium mgmt / Broadcast / System announcements
  (reports captured in DB; dashboard is a web-admin surface)

## Platform / Misc
- ✅ Story/Status with viewers (status done; viewer counts 🟡)
- 🟡 Live location sharing · 🟡 File sharing (large) — basic file share ✅
- 🟡 Cloud backup & restore · 🟡 Multi-device login
- ✅ Desktop (Windows/macOS/Linux) = deployed web app / PWA
- ✅ Android app · 🟡 iOS app (needs a macOS/EAS iOS build)

> Items needing external infrastructure (push credentials, TURN for calls at
> scale, FCM, iOS signing, an admin web surface) have the **app-side built** and
> the infra requirement documented. See BUILD_ANDROID.md and migration files.
>
> **DB migrations:** Communities/polls/events (`0007_communities.sql`) and trust &
> safety (`0008_support_safety.sql`) must be applied to the live Supabase DB for
> these features to work at runtime. This Mac has no `psql`/CLI link and the repo
> keeps the DB password out of `.env`, so run `scripts/apply-migrations.sh`
> (supply `SUPABASE_DB_PASSWORD`) or paste both files into the Dashboard SQL
> editor. Both are idempotent.
