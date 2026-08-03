# FUTUREHAT Streak System — Implementation Plan

Production-grade, server-authoritative relationship streaks between the two users of
each **direct** conversation. Built on the existing architecture (no duplicate tables,
no regressions). Scope this pass: **Backend + shared API + full mobile UI + tests**.
Web UI (emoji + settings + Hall of Legends) is an immediate follow-up (web keeps
compiling this pass).

Locked decisions: **UTC calendar-day** window · **backend auto-assign** moderator at
367 (deterministic, server-only, audited) · **backend + mobile first**.

---

## 1. Canonical pair identity (why it's immune to archive/lock/hide)

The pair identity is the existing **`type='direct'` `conversations.id`**, which
`start_direct_conversation()` (0001) already guarantees is unique per unordered user
pair. Archive/lock/hide/delete-for-me are all **separate per-user tables**
(`archived_conversations`, `locked_conversations`, `hidden_*`, `deleted_conversations`)
keyed on `(user_id, conversation_id)` — they never touch `conversations`, `messages`,
or `calls`. Binding the streak to `conversation_id` therefore makes it structurally
impossible for those UI features to reset/pause/duplicate/delete the streak.

Defense-in-depth: also store canonical `user_lo < user_hi` on the streak row, with a
`UNIQUE` constraint, so even a hypothetical duplicate direct conversation can't create
two streak records for the same pair.

---

## 2. Database — new migration `supabase/migrations/0029_streaks.sql`

Additive, idempotent (`create ... if not exists`, `drop policy if exists`), follows the
existing SECURITY DEFINER + RLS + `_audit()` conventions. **No client can set a score.**

### Tables

- **`streaks`** — one row per pair (the ledger head).
  `id`, `conversation_id uuid unique → conversations(id)`, `user_lo uuid`, `user_hi uuid`
  (`unique(user_lo,user_hi)`, `check user_lo < user_hi`), `score int not null default 0
  check score >= 0`, `successful_days int not null default 0`, `last_awarded_day date`,
  `last_processed_day date`, `created_at`, `updated_at`. Score writes only via SECURITY
  DEFINER functions (no UPDATE policy for `authenticated`).

- **`streak_days`** — per pair, per UTC day, per-user qualification flags (idempotent
  event capture). PK `(streak_id, day)`. `user_lo_qualified bool`, `user_hi_qualified
  bool`, `completed bool`, `awarded bool`, plus first-qualifying-activity timestamps.
  A row is upserted the moment either user performs a qualifying activity.

- **`streak_events`** — append-only audit ledger of every score change (`+1` / `-3` /
  milestone), with `day`, `delta`, `old_score`, `new_score`, `reason`. Immutable
  (no UPDATE/DELETE policy). Powers "Streak History".

- **`streak_milestones`** — one row per (streak, milestone_kind) achievement, e.g.
  `diamond`, `mod_eligible`, `hall_of_legends`. **`unique(streak_id, kind)`** — this is
  the anti-farming guarantee: a milestone can be achieved (and rewarded) exactly once
  ever, regardless of later score loss and re-gain. Records `achieved_at`,
  `reward_granted bool`, `reward_granted_at`, `meta jsonb`.

### Tier helper (single source of truth)

`public.streak_tier(score int) returns text` — pure `immutable` SQL mapping score →
emoji, matching the spec exactly:
`🎏 1–16 · 💙 17–44 · ❤️ 45–99 · 💜 100–199 · 🎖️ 200–364 · 💎 =365 · 🪙 366–729 ·
🏆 730+` (score 0 → `🎏`/none). Both DB and clients compute the emoji from the
authoritative score; the same mapping is mirrored in `shared/streakApi.ts` so the UI
never hardcodes a fake emoji.

### Qualification (integrates the REAL message/media/call schema)

`public._streak_qualifies_message(msg)` / call logic, applied server-side:

- **Text**: `type='text'` AND `not is_deleted` AND word-count(content) ≥ 5. Word count =
  count of whitespace-separated tokens containing ≥1 alphanumeric char (so "hi . . . ."
  is 1 word, not 5). A single message must itself reach 5 words — separate messages
  never combine.
- **Photo/Video**: `type='image'` or `type='file'` with a non-null `media_url`, `not
  is_deleted`. (Base schema has no distinct `video` type — media is image/file+media_url;
  confirmed via migrations 0001/0027.)
- **Call**: `calls.status='ended'` AND `answered_at is not null` AND
  `ended_at - answered_at > interval '15 seconds'`. Ring time (`started_at→answered_at`)
  is excluded; missed/declined/ringing/never-answered never qualify.

### Recording qualification — `record_streak_activity(p_conversation uuid)` (RPC)

Called by clients as a lightweight signal ("I just did something qualifying here"), but
it **re-derives** qualification from the authoritative tables for `auth.uid()` on the
current UTC day — it trusts nothing from the client except *which conversation*. It:
1. verifies caller `is_member` and the conversation is `type='direct'`;
2. resolves/creates the `streaks` row (canonical pair);
3. checks the DB for a genuine qualifying message/call by the caller today;
4. upserts today's `streak_days` row setting the caller's `_qualified` flag.
Idempotent: repeat calls the same day are no-ops (flag already set). This is also
invoked opportunistically after send/call-end in the clients, and re-derived by the
daily job regardless, so a missed client call never loses a streak.

### Daily processing — `process_streak_day(p_day date default null)` (SECURITY DEFINER)

Mirrors the existing `dispatch_due_messages` pattern (cron-run + client-callable
fallback). For the target day (default = **yesterday UTC**, so the window is closed):

- Re-derives both users' qualification for the day directly from `messages`/`calls`
  (authoritative; not from client flags alone), updates `streak_days`.
- **Award** (`completed AND NOT awarded`, `last_awarded_day <> day`): `score += 1`,
  `successful_days += 1`, `awarded = true`, append `streak_events(+1)`.
- **Penalty** (day passed, not completed, not already processed): `score = max(0,
  score - 3)`, append `streak_events(-3)`. Never below 0.
- Advisory lock per streak + `last_processed_day` guard ⇒ **idempotent & race-safe**;
  running twice for the same day changes nothing.
- After the score change, evaluate milestones **from the ledger, once each**:
  - **Diamond (=365, first time)** → insert `streak_milestones('diamond')` (unique),
    then grant **1 month FUTUREHAT+** to *both* users via a **safe-extend** that never
    shortens an existing sub: `current_period_end = greatest(now(), coalesce(existing,
    now())) + interval '1 month'` (upsert). Reward is idempotent (guarded by the unique
    milestone + `reward_granted`). This deliberately does NOT reuse `admin_grant_premium`,
    which *overwrites* `current_period_end` and could shorten a longer existing sub.
  - **Moderator eligibility (=367)** → insert `streak_milestones('mod_eligible')`,
    deterministically pick ONE candidate (`user_lo` — stable, auditable), and if they're
    a plain `user` and account is active, set `role='moderator'` + mailbox notice +
    `_audit('streak_assign_moderator', …)`. Never touches owner/admin; never escalates;
    server-only. (Per your choice: auto-assign, no admin gate.)
  - **Hall of Legends (≥730, first time)** → insert `streak_milestones('hall_of_legends')`
    with `achieved_at`; preserved forever even if score later drops.
- Emits a mailbox notice (`user_warnings` kind `'info'`, the working in-app
  notification surface) for: completed today, +1, penalty, tier up/down, Diamond,
  Premium granted, mod eligibility, Hall of Legends. Push (FCM) is wired via the
  existing `sendPush`/`system` kind but only delivers if FCM is configured (documented).

### Read RPCs (efficient, no N+1)

- `get_my_streaks()` → JSON array of the caller's pairs: `conversation_id`, peer profile,
  `score`, `tier`, `successful_days`, `completed_today`, `waiting_on_peer`,
  `milestones`. One query, powers chat-list emojis in a single round-trip (avoids
  per-row fetches).
- `get_streak(p_conversation)` → one pair's full detail + recent `streak_events`.
- `get_hall_of_legends(p_limit, p_before)` → paginated legendary pairs, respecting
  profile visibility; server-authoritative eligibility; keyset pagination.

### Scheduling

Add a `pg_cron` schedule (guarded `do $$ … create extension if not exists pg_cron … $$`)
to run `process_streak_day()` shortly after 00:00 UTC. Because pg_cron availability
varies by plan, the migration documents it and the app also calls `process_streak_day()`
opportunistically on launch (the same safety net `dispatch_due_messages` uses), so
processing is reliable without depending on the app being open at midnight.

### RLS

- `streaks` / `streak_days` / `streak_events` / `streak_milestones`: SELECT allowed to
  the two members (via `is_member(conversation_id)`); **no INSERT/UPDATE/DELETE** for
  `authenticated` (all writes go through SECURITY DEFINER RPCs). Hall of Legends read is
  via the SECURITY DEFINER RPC only.
- `grant execute` on the RPCs to `authenticated`.

---

## 3. Shared API — `shared/streakApi.ts` (+ types in `shared/types.ts`)

Framework-agnostic, matches the existing module idiom (functions take `SupabaseClient`).

- Types: `Streak`, `StreakDay`, `StreakEvent`, `StreakMilestone`, `StreakSummary`,
  `HallOfLegendsEntry`, `StreakTier`.
- `STREAK_TIERS` table + `tierForScore(score)` / `emojiForScore(score)` — **mirror of the
  SQL `streak_tier`**, so clients render the emoji from the authoritative score with no
  extra round-trip and never hardcode.
- `getMyStreaks`, `getStreak`, `getHallOfLegends`, `recordStreakActivity`,
  `processStreakDay` (client fallback), `subscribeStreakChanges` (one debounced realtime
  channel over `streaks`/`streak_events`, mirroring `subscribeCallChanges`).
- Add `streaks` (+ `streak_events`) to `supabase_realtime` publication in the migration.
- Re-export from `mobile/src/lib/shared.ts` barrel (`export * from
  '../../../shared/streakApi'`).

---

## 4. Mobile UI (React Native / Expo)

### Chat-list emoji (`ConversationsScreen.tsx`)
- On focus: hydrate streak summaries from local cache (`getCache('streaks:<uid>', [])`)
  → instant, offline. Background `getMyStreaks()` → update state + rewrite cache. No
  flicker, no per-row network. Realtime subscription refreshes on change.
- Render the tier emoji in the existing `rowIcons` block (lines ~598–615), immediately
  before the unread badge — does not disturb lock/mute/pin/disappearing/timestamp.
- Never computes authoritative score locally; emoji derives from server `score`.

### Settings → Streaks (new)
- Add a `Row` "Streaks" (🎏) to `SettingsScreen.tsx`; register screens in
  `navigation/types.ts` + `App.tsx`.
- New screens (existing theme: `useColors/spacing/radius/font`, `Group`/`Row` idiom):
  - `StreaksScreen` — list of the user's active streaks (emoji, score, tier,
    completed-today / waiting-on-peer), loading/empty/error states, links to detail; and
    links to the info pages + Hall of Legends.
  - `StreakDetailScreen` — one pair: big tier emoji, score, progress to next tier,
    milestone history, recent `streak_events` (Streak History).
  - Info pages (static, on-brand): **How Streaks Work**, **Qualifying Activities**,
    **Streak Levels** (full ladder with emojis + ranges), **Rewards**, **Penalties &
    Demotions** (100 💜 → 97 ❤️ example), **Restrictions & Anti-Abuse**, **Moderator
    Selection**, **Hall of Legends**. (Implemented as a compact data-driven info screen
    to keep it maintainable and consistent.)
  - `HallOfLegendsScreen` — paginated 🏆 pairs; loading/empty/error/offline-cache.
- Offline: all local UI ops (archive/lock/etc.) stay instant and never block on streak
  network calls. Streak reads are cache-first; authoritative points are server-only.

### Admin/Moderator visibility (mobile)
- Add read-only streak audit to the existing Admin dashboard screen: milestone/reward
  history + Hall of Legends + mod-reward audit, via an admin-gated RPC
  (`admin_streak_audit()` reusing `_require_admin`). Moderators get NO score-write power.

---

## 5. Tests & validation (no jest/vitest in repo → DB + build)

- **`scripts/streak-tests.sql`** — self-contained transactional harness (BEGIN…ROLLBACK)
  seeding two users + a direct conversation and asserting, with `RAISE EXCEPTION` on
  failure:
  1. 4-word msg does NOT qualify; 5-word msg does.
  2. Five 1-word msgs do NOT combine.
  3. Photo / (image+media) qualifies; deleted message doesn't.
  4. 15s call doesn't qualify; 16s connected call does; missed/declined/ring-only don't.
  5. Both qualify → +1 exactly once/day (100 msgs from one side alone → no award).
  6. Missed day → −3, floored at 0.
  7. Tier transitions (incl. 100→97 demotion 💜→❤️).
  8. Diamond at 365 grants premium once; re-reaching after loss does NOT re-grant;
     premium extend never shortens a longer existing sub.
  9. 367 → exactly one member becomes moderator; owner/admin never altered; re-processing
     doesn't duplicate.
  10. 730 → Hall of Legends once; survives later score drop.
  11. `process_streak_day` idempotent (double-run = no change).
  12. Archive/lock rows don't change score.
- **Typecheck/build**: `cd mobile && npm run typecheck`; `cd web && npm run build`
  (`tsc && vite build`) to prove no regression. Fix any errors I introduce.
- The SQL harness is runnable via the existing `scripts/apply-migrations.sh` connection
  pattern (owner supplies `SUPABASE_DB_PASSWORD`); I will run it if DB access is
  available, otherwise document exact run steps.

---

## 6. Files changed (this pass)

**New**
- `supabase/migrations/0029_streaks.sql`
- `shared/streakApi.ts`
- `mobile/src/screens/StreaksScreen.tsx`, `StreakDetailScreen.tsx`,
  `StreakInfoScreen.tsx`, `HallOfLegendsScreen.tsx`
- `scripts/streak-tests.sql`

**Edited**
- `shared/types.ts` (+streak types)
- `mobile/src/lib/shared.ts` (barrel re-export)
- `mobile/src/screens/ConversationsScreen.tsx` (chat-list emoji + cache-first load)
- `mobile/src/screens/SettingsScreen.tsx` (Streaks row)
- `mobile/src/navigation/types.ts` + `mobile/src/App.tsx` (register screens)
- `mobile/src/screens/admin/*` (read-only streak audit section)

**Follow-up (next pass, web parity):** chat-row emoji in `web/src/App.tsx`, a Streaks
section in `web/src/premium/SettingsModal.tsx`, a web Hall of Legends view, and web admin
visibility. Nothing in this pass breaks the web build.

## 7. Guarantees mapped to spec
- Server-authoritative scores/rewards/roles; client can never set score or claim
  milestones (no write RLS; SECURITY DEFINER only).
- Idempotent & race-safe daily processing (advisory lock + day guards + unique
  constraints).
- Anti-farming: `unique(streak_id, kind)` milestones — reward/mod/HoL exactly once ever.
- Premium safe-extend never shortens an existing subscription.
- Archive/lock/hide/delete-for-me provably cannot affect the streak (separate tables).
- UTC-day boundary immune to device clock/timezone.
- No existing feature removed; additive migration; Android/Web/iOS compatible.
