-- 0029_streaks.sql — Lumixo relationship Streak System.
-- ============================================================================
-- ADDITIVE ONLY + idempotent (create ... if not exists / drop policy if exists /
-- create or replace). Server-authoritative: clients can NEVER set a score, claim
-- a milestone, or grant a reward — every mutation goes through a SECURITY DEFINER
-- function; the tables have SELECT-only RLS for `authenticated`.
--
-- IDENTITY: a streak belongs to the UNIQUE PAIR OF USERS, materialised as the
-- existing type='direct' conversation (start_direct_conversation(), 0001, already
-- guarantees one direct conversation per unordered user pair). We ALSO store the
-- canonical ordered pair (user_lo < user_hi) with a UNIQUE constraint as
-- defence-in-depth against any duplicate direct conversation. Archive / lock /
-- hide / delete-for-me are SEPARATE per-user tables (archived_conversations 0010,
-- locked_conversations 0027, deleted_conversations 0016) that never touch
-- conversations/messages/calls — so those UI features structurally cannot reset,
-- pause, duplicate or delete a streak.
--
-- DAILY WINDOW: one UTC calendar day ((now() at time zone 'utc')::date). Backend
-- controls the boundary; the device clock/timezone is never trusted.
--
-- Reuses: is_member (0001), is_premium/subscriptions (0003), is_owner/is_admin/
-- is_account_active/_audit/audit_log (0010/0013), user_warnings mailbox (0017/0023),
-- profiles.role (0013). Mirrors the dispatch_due_messages (0003) cron+fallback
-- pattern. Apply after 0028. Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per pair (the ledger head). Score writes ONLY via SECURITY DEFINER fns.
create table if not exists public.streaks (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null unique references public.conversations(id) on delete cascade,
  user_lo           uuid not null references public.profiles(id) on delete cascade,
  user_hi           uuid not null references public.profiles(id) on delete cascade,
  score             int  not null default 0 check (score >= 0),
  successful_days   int  not null default 0 check (successful_days >= 0),
  last_awarded_day  date,
  last_processed_day date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint streaks_pair_order  check (user_lo < user_hi),
  constraint streaks_pair_unique unique (user_lo, user_hi)
);
create index if not exists idx_streaks_user_lo on public.streaks(user_lo);
create index if not exists idx_streaks_user_hi on public.streaks(user_hi);

-- Per pair, per UTC day: each user's qualification flags (idempotent event capture).
create table if not exists public.streak_days (
  streak_id         uuid not null references public.streaks(id) on delete cascade,
  day               date not null,
  user_lo_qualified boolean not null default false,
  user_hi_qualified boolean not null default false,
  completed         boolean not null default false,
  awarded           boolean not null default false,
  penalized         boolean not null default false,
  lo_qualified_at   timestamptz,
  hi_qualified_at   timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (streak_id, day)
);
create index if not exists idx_streak_days_day on public.streak_days(day);

-- Append-only score-change ledger (immutable — no UPDATE/DELETE policy). Powers
-- "Streak History".
create table if not exists public.streak_events (
  id         uuid primary key default gen_random_uuid(),
  streak_id  uuid not null references public.streaks(id) on delete cascade,
  day        date,
  delta      int  not null,
  old_score  int  not null,
  new_score  int  not null,
  reason     text not null,          -- 'daily_award' | 'missed_penalty' | 'milestone' | ...
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_streak_events_streak on public.streak_events(streak_id, created_at desc);

-- One row per (streak, milestone kind) EVER. unique(streak_id, kind) is the
-- anti-farming guarantee: a milestone (and its reward) fires exactly once for the
-- lifetime of the pair, regardless of later score loss and re-gain.
create table if not exists public.streak_milestones (
  id                uuid primary key default gen_random_uuid(),
  streak_id         uuid not null references public.streaks(id) on delete cascade,
  kind              text not null check (kind in ('diamond','mod_eligible','hall_of_legends')),
  achieved_at       timestamptz not null default now(),
  achieved_score    int not null,
  reward_granted    boolean not null default false,
  reward_granted_at timestamptz,
  meta              jsonb not null default '{}'::jsonb,
  unique (streak_id, kind)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) TIER (single source of truth; clients mirror this exactly)
-- ─────────────────────────────────────────────────────────────────────────────
-- 🎏 1–16 · 💙 17–44 · ❤️ 45–99 · 💜 100–199 · 🎖️ 200–364 · 💎 =365 ·
-- 🪙 366–729 · 🏆 730+.  (score 0 ⇒ no tier)
create or replace function public.streak_tier(p_score int)
returns text language sql immutable set search_path = public as $$
  select case
    when p_score is null or p_score <= 0 then ''
    when p_score between 1   and 16  then '🎏'
    when p_score between 17  and 44  then '💙'
    when p_score between 45  and 99  then '❤️'
    when p_score between 100 and 199 then '💜'
    when p_score between 200 and 364 then '🎖️'
    when p_score = 365               then '💎'
    when p_score between 366 and 729 then '🪙'
    else '🏆'
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) QUALIFICATION HELPERS (integrate the REAL message/media/call schema)
-- ─────────────────────────────────────────────────────────────────────────────

-- Word count = whitespace-separated tokens that contain ≥1 alphanumeric char, so
-- "hi . . . ." is 1 word (not 5) and five separate 1-word messages never combine
-- (this counts within ONE message's text only).
create or replace function public._streak_word_count(p_text text)
returns int language sql immutable set search_path = public as $$
  select coalesce((
    select count(*)::int
    from regexp_split_to_table(coalesce(p_text, ''), '\s+') as tok
    where tok ~ '[[:alnum:]]'
  ), 0);
$$;

-- Did user `u` perform ≥1 qualifying activity in conversation `conv` on UTC day `d`?
--   • text message with ≥5 real words (not deleted), OR
--   • a photo/video = image|file message with media_url (not deleted), OR
--   • ANY connected voice/video call in the pair >15s (a connected call is mutual,
--     so it qualifies BOTH members).
-- Failed/unsent/draft messages are never rows in public.messages, so they can't
-- qualify. Ring time is excluded (uses ended_at - answered_at). Missed/declined/
-- ringing/never-answered calls have answered_at IS NULL or status<>'ended'.
create or replace function public._streak_user_qualified(p_conv uuid, p_user uuid, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.messages m
      where m.conversation_id = p_conv
        and m.sender_id = p_user
        and coalesce(m.is_deleted, false) = false
        and (m.created_at at time zone 'utc')::date = p_day
        and (
          (m.type = 'text' and public._streak_word_count(m.content) >= 5)
          or (m.type in ('image','file') and coalesce(m.media_url, '') <> '')
        )
    )
    or exists (
      select 1 from public.calls c
      where c.conversation_id = p_conv
        and c.status = 'ended'
        and c.answered_at is not null
        and c.ended_at is not null
        and (c.ended_at - c.answered_at) > interval '15 seconds'
        and (c.answered_at at time zone 'utc')::date = p_day
    );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) PAIR RESOLUTION
-- ─────────────────────────────────────────────────────────────────────────────
-- Resolve (or create) the streak row for a direct conversation. Validates it is a
-- 2-person direct chat and stores the canonical ordered pair. Idempotent.
create or replace function public._streak_get_or_create(p_conv uuid)
returns public.streaks language plpgsql security definer set search_path = public as $$
declare
  v_row public.streaks;
  v_type text;
  v_lo uuid;
  v_hi uuid;
  v_ids uuid[];
begin
  select * into v_row from public.streaks where conversation_id = p_conv;
  if found then
    return v_row;
  end if;

  select type into v_type from public.conversations where id = p_conv;
  if v_type is distinct from 'direct' then
    raise exception 'streaks are only for direct conversations';
  end if;

  -- Order the two participant ids canonically. Postgres has no min/max aggregate
  -- for uuid, so use array_agg(... order by ...) and take the ends.
  select array_agg(user_id order by user_id)
    into v_ids
  from public.conversation_participants where conversation_id = p_conv;

  if v_ids is null or array_length(v_ids, 1) <> 2 then
    raise exception 'direct conversation must have exactly 2 participants';
  end if;
  v_lo := v_ids[1];
  v_hi := v_ids[2];

  insert into public.streaks (conversation_id, user_lo, user_hi)
  values (p_conv, v_lo, v_hi)
  on conflict (conversation_id) do nothing;

  select * into v_row from public.streaks where conversation_id = p_conv;
  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) LIVE ACTIVITY SIGNAL (client-callable; server re-derives, trusts nothing)
-- ─────────────────────────────────────────────────────────────────────────────
-- Clients may call this after sending a qualifying message / ending a call to keep
-- the "waiting on peer / done today" UI live. It TRUSTS ONLY the conversation id:
-- it re-derives the caller's qualification from the authoritative tables for TODAY
-- (UTC) and upserts today's flags. It NEVER changes the score (that is the daily
-- job's job). Idempotent.
create or replace function public.record_streak_activity(p_conversation uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_s    public.streaks;
  v_day  date := (now() at time zone 'utc')::date;
  v_lo_q boolean;
  v_hi_q boolean;
  v_completed boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_conversation) then raise exception 'not a member'; end if;

  v_s := public._streak_get_or_create(p_conversation);

  -- Re-derive both members for today (a connected call qualifies both members, so
  -- computing both here keeps the live UI correct no matter who calls).
  v_lo_q := public._streak_user_qualified(p_conversation, v_s.user_lo, v_day);
  v_hi_q := public._streak_user_qualified(p_conversation, v_s.user_hi, v_day);
  v_completed := v_lo_q and v_hi_q;

  insert into public.streak_days (streak_id, day, user_lo_qualified, user_hi_qualified,
                                  completed, lo_qualified_at, hi_qualified_at, updated_at)
  values (v_s.id, v_day, v_lo_q, v_hi_q, v_completed,
          case when v_lo_q then now() end, case when v_hi_q then now() end, now())
  on conflict (streak_id, day) do update set
    user_lo_qualified = streak_days.user_lo_qualified or excluded.user_lo_qualified,
    user_hi_qualified = streak_days.user_hi_qualified or excluded.user_hi_qualified,
    completed = (streak_days.user_lo_qualified or excluded.user_lo_qualified)
            and (streak_days.user_hi_qualified or excluded.user_hi_qualified),
    lo_qualified_at = coalesce(streak_days.lo_qualified_at, excluded.lo_qualified_at),
    hi_qualified_at = coalesce(streak_days.hi_qualified_at, excluded.hi_qualified_at),
    updated_at = now();

  return json_build_object(
    'conversation_id', p_conversation,
    'score', v_s.score,
    'tier', public.streak_tier(v_s.score),
    'day', v_day,
    'lo_qualified', v_lo_q,
    'hi_qualified', v_hi_q,
    'completed_today', v_completed
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) REWARD HELPERS (server-only; safe & idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- Grant/EXTEND one month of Lumixo+ WITHOUT ever shortening an existing sub:
-- extend from greatest(existing_end, now()) + 1 month. Unlike admin_grant_premium
-- (0013), which OVERWRITES current_period_end and could shorten a longer sub, this
-- only ever moves the end date forward. Keeps the existing plan on conflict.
create or replace function public._streak_grant_month_premium(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, plan, status, provider, amount_inr,
      current_period_start, current_period_end, cancel_at_period_end, updated_at)
  values (p_user, 'monthly', 'active', 'manual', 0,
      now(), now() + interval '1 month', false, now())
  on conflict (user_id) do update set
    status = 'active',
    current_period_end = greatest(public.subscriptions.current_period_end, now()) + interval '1 month',
    cancel_at_period_end = false,
    updated_at = now();
end;
$$;

-- Re-define the profiles role/status guard (0015) to ALSO permit a single, server-
-- authorised streak promotion to 'moderator'. Everything else is byte-for-byte the
-- 0015 behaviour: a non-admin caller still has every privileged column reverted.
-- The ONLY new escape hatch is a transaction-local GUC (futurehat.streak_promote)
-- that _streak_check_milestones sets to the exact user id it is promoting, for one
-- statement, and only ever to 'moderator' (never admin/owner). A client cannot set
-- a transaction-local GUC on the authenticated role in a way that reaches this
-- path, and the promote target must match the row being updated.
create or replace function public.guard_profile_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_promote text := current_setting('futurehat.streak_promote', true);
begin
  if not public.is_admin(auth.uid()) then
    -- Allow ONLY the flagged streak promotion of THIS row to 'moderator'.
    if v_promote is not null and v_promote <> ''
       and v_promote = new.id::text
       and new.role = 'moderator' and old.role = 'user' then
      -- permit role → 'moderator'; still protect every other privileged column
      new.account_status  := old.account_status;
      new.status_reason   := old.status_reason;
      new.suspended_until := old.suspended_until;
      new.verified        := old.verified;
      new.verified_at     := old.verified_at;
      new.banned_at       := old.banned_at;
      new.deleted_at      := old.deleted_at;
      new.force_logout_at := old.force_logout_at;
    else
      new.role            := old.role;
      new.account_status  := old.account_status;
      new.status_reason   := old.status_reason;
      new.suspended_until := old.suspended_until;
      new.verified        := old.verified;
      new.verified_at     := old.verified_at;
      new.banned_at       := old.banned_at;
      new.deleted_at      := old.deleted_at;
      new.force_logout_at := old.force_logout_at;
    end if;
  end if;
  return new;
end $$;

-- Deliver a streak notice to a user's mailbox (the working in-app notification
-- surface, user_warnings 0017/0023). kind 'info' for streak updates.
create or replace function public._streak_notify(p_user uuid, p_title text, p_message text, p_kind text default 'info')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_warnings (user_id, kind, title, message, created_by)
  values (p_user, p_kind, p_title, p_message, null);
end;
$$;

-- Evaluate milestones from the LEDGER (once each, guarded by unique(streak_id,kind)).
-- Called after any score increase. Handles Diamond (premium ×2), Mod eligibility
-- (auto-assign ONE deterministic member), and Hall of Legends.
create or replace function public._streak_check_milestones(p_streak uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s public.streaks;
  v_cand uuid;
  v_other uuid;
  v_ins int;
begin
  select * into v_s from public.streaks where id = p_streak;
  if not found then return; end if;

  -- DIAMOND (first time reaching 365) → 1 month Lumixo+ for BOTH users.
  if v_s.score >= 365 then
    insert into public.streak_milestones (streak_id, kind, achieved_score, meta)
    values (p_streak, 'diamond', v_s.score,
            jsonb_build_object('conversation_id', v_s.conversation_id))
    on conflict (streak_id, kind) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      perform public._streak_grant_month_premium(v_s.user_lo);
      perform public._streak_grant_month_premium(v_s.user_hi);
      update public.streak_milestones set reward_granted = true, reward_granted_at = now()
        where streak_id = p_streak and kind = 'diamond';
      perform public._streak_notify(v_s.user_lo, '💎 Diamond achieved!',
        'You and your streak partner reached 365 — Diamond! Enjoy 1 month of Lumixo+ on us.');
      perform public._streak_notify(v_s.user_hi, '💎 Diamond achieved!',
        'You and your streak partner reached 365 — Diamond! Enjoy 1 month of Lumixo+ on us.');
      insert into public.audit_log (user_id, action, target, meta)
      values (null, 'streak_diamond_reward', p_streak::text,
        jsonb_build_object('users', jsonb_build_array(v_s.user_lo, v_s.user_hi)));
    end if;
  end if;

  -- MODERATOR ELIGIBILITY (first time reaching 367) → auto-assign ONE member.
  -- Deterministic candidate = user_lo; fall back to user_hi if user_lo isn't a
  -- plain active 'user'. NEVER touches owner/admin; never escalates; server-only.
  if v_s.score >= 367 then
    insert into public.streak_milestones (streak_id, kind, achieved_score, meta)
    values (p_streak, 'mod_eligible', v_s.score,
            jsonb_build_object('conversation_id', v_s.conversation_id))
    on conflict (streak_id, kind) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      v_cand := null;
      -- prefer user_lo, else user_hi; only a plain active 'user' is eligible.
      if (select role from public.profiles where id = v_s.user_lo) = 'user'
         and public.is_account_active(v_s.user_lo)
         and not public.is_owner(v_s.user_lo) then
        v_cand := v_s.user_lo; v_other := v_s.user_hi;
      elsif (select role from public.profiles where id = v_s.user_hi) = 'user'
         and public.is_account_active(v_s.user_hi)
         and not public.is_owner(v_s.user_hi) then
        v_cand := v_s.user_hi; v_other := v_s.user_lo;
      end if;

      if v_cand is not null then
        -- profiles.role is protected by the guard_profile_privileged() BEFORE UPDATE
        -- trigger (0015): it reverts any role change unless is_admin(auth.uid()).
        -- This milestone runs from cron/system context (auth.uid() is null), so we
        -- flag this specific, server-authorised promotion via a transaction-local
        -- GUC the guard recognises. The flag lives only for this statement and is
        -- reset immediately after, so nothing else can ride it.
        perform set_config('futurehat.streak_promote', v_cand::text, true);
        update public.profiles set role = 'moderator' where id = v_cand and role = 'user';
        perform set_config('futurehat.streak_promote', '', true);
        update public.streak_milestones
          set reward_granted = true, reward_granted_at = now(),
              meta = meta || jsonb_build_object('moderator', v_cand)
          where streak_id = p_streak and kind = 'mod_eligible';
        perform public._streak_notify(v_cand, '🛡 You are now a Lumixo Moderator',
          'Your legendary streak earned you Moderator status. Please use it responsibly.',
          'mod_appointed');
        perform public._streak_notify(v_other, '🛡 Moderator selected',
          'Your streak reached the Moderator milestone — your partner was selected as Moderator.');
        insert into public.audit_log (user_id, action, target, meta)
        values (null, 'streak_assign_moderator', v_cand::text,
          jsonb_build_object('streak', p_streak, 'score', v_s.score,
                             'conversation_id', v_s.conversation_id));
      else
        update public.streak_milestones
          set meta = meta || jsonb_build_object('moderator', null, 'note', 'no eligible plain-user member')
          where streak_id = p_streak and kind = 'mod_eligible';
      end if;
    end if;
  end if;

  -- HALL OF LEGENDS (first time reaching 730) → recorded forever.
  if v_s.score >= 730 then
    insert into public.streak_milestones (streak_id, kind, achieved_score, meta)
    values (p_streak, 'hall_of_legends', v_s.score,
            jsonb_build_object('conversation_id', v_s.conversation_id))
    on conflict (streak_id, kind) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      perform public._streak_notify(v_s.user_lo, '🏆 Hall of Legends!',
        'Two years of streak — you are now Lumixo legends. 🏆');
      perform public._streak_notify(v_s.user_hi, '🏆 Hall of Legends!',
        'Two years of streak — you are now Lumixo legends. 🏆');
    end if;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) CORE DAILY EVALUATION (idempotent, race-safe)
-- ─────────────────────────────────────────────────────────────────────────────
-- Evaluate ONE (streak, day): recompute both members' qualification from source,
-- award +1 if mutually completed (once), else −3 if the day is fully past (once,
-- floored at 0). Guarded by streak_days.awarded / .penalized and a per-streak
-- advisory lock so double execution is a no-op.
create or replace function public._streak_process_one(p_streak uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s     public.streaks;
  v_lo_q  boolean;
  v_hi_q  boolean;
  v_completed boolean;
  v_awarded boolean;
  v_penalized boolean;
  v_old int;
  v_new int;
  v_today date := (now() at time zone 'utc')::date;
  v_old_tier text;
  v_new_tier text;
begin
  -- Serialise processing of this streak (race-safe across cron + client fallback).
  perform pg_advisory_xact_lock(hashtextextended(p_streak::text, 0));

  select * into v_s from public.streaks where id = p_streak;
  if not found then return; end if;

  v_lo_q := public._streak_user_qualified(v_s.conversation_id, v_s.user_lo, p_day);
  v_hi_q := public._streak_user_qualified(v_s.conversation_id, v_s.user_hi, p_day);
  v_completed := v_lo_q and v_hi_q;

  insert into public.streak_days (streak_id, day, user_lo_qualified, user_hi_qualified, completed, updated_at)
  values (p_streak, p_day, v_lo_q, v_hi_q, v_completed, now())
  on conflict (streak_id, day) do update set
    user_lo_qualified = excluded.user_lo_qualified,
    user_hi_qualified = excluded.user_hi_qualified,
    completed = excluded.completed,
    updated_at = now();

  select awarded, penalized into v_awarded, v_penalized
  from public.streak_days where streak_id = p_streak and day = p_day;

  v_old := v_s.score;
  v_old_tier := public.streak_tier(v_old);

  if v_completed and not v_awarded and coalesce(v_s.last_awarded_day, 'epoch') <> p_day then
    -- AWARD +1 (max +1 per completed day)
    v_new := v_old + 1;
    update public.streaks
      set score = v_new, successful_days = successful_days + 1,
          last_awarded_day = p_day, updated_at = now()
      where id = p_streak;
    update public.streak_days set awarded = true, updated_at = now()
      where streak_id = p_streak and day = p_day;
    insert into public.streak_events (streak_id, day, delta, old_score, new_score, reason)
    values (p_streak, p_day, 1, v_old, v_new, 'daily_award');

    v_new_tier := public.streak_tier(v_new);
    perform public._streak_notify(v_s.user_lo, '🔥 Streak +1',
      'Your streak with your partner is now ' || v_new || ' ' || v_new_tier || '.');
    perform public._streak_notify(v_s.user_hi, '🔥 Streak +1',
      'Your streak with your partner is now ' || v_new || ' ' || v_new_tier || '.');
    if v_new_tier <> v_old_tier then
      perform public._streak_notify(v_s.user_lo, 'Tier up! ' || v_new_tier,
        'Your streak reached a new tier: ' || v_new_tier || ' (' || v_new || ').');
      perform public._streak_notify(v_s.user_hi, 'Tier up! ' || v_new_tier,
        'Your streak reached a new tier: ' || v_new_tier || ' (' || v_new || ').');
    end if;

    perform public._streak_check_milestones(p_streak);

  elsif (not v_completed) and (not v_penalized) and p_day < v_today then
    -- MISSED DAY (window fully closed) → −3, floored at 0.
    v_new := greatest(0, v_old - 3);
    if v_new <> v_old then
      update public.streaks set score = v_new, updated_at = now() where id = p_streak;
      insert into public.streak_events (streak_id, day, delta, old_score, new_score, reason)
      values (p_streak, p_day, v_new - v_old, v_old, v_new, 'missed_penalty');
      v_new_tier := public.streak_tier(v_new);
      perform public._streak_notify(v_s.user_lo, '💔 Streak penalty −3',
        'A day was missed. Your streak is now ' || v_new || ' ' || v_new_tier || '.');
      perform public._streak_notify(v_s.user_hi, '💔 Streak penalty −3',
        'A day was missed. Your streak is now ' || v_new || ' ' || v_new_tier || '.');
      if v_new_tier <> v_old_tier then
        perform public._streak_notify(v_s.user_lo, 'Tier changed ' || v_new_tier,
          'Your streak tier is now ' || v_new_tier || ' (' || v_new || ').');
        perform public._streak_notify(v_s.user_hi, 'Tier changed ' || v_new_tier,
          'Your streak tier is now ' || v_new_tier || ' (' || v_new || ').');
      end if;
    end if;
    update public.streak_days set penalized = true, updated_at = now()
      where streak_id = p_streak and day = p_day;
  end if;
end;
$$;

-- Walk a single streak from the day after last_processed_day up to p_day, applying
-- award/penalty for each day, then advance last_processed_day. Catch-up safe (a
-- dormant streak is penalised for each missed day). Capped to avoid pathological
-- backfills; the daily cron keeps this to one day.
create or replace function public._streak_advance(p_streak uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s public.streaks;
  v_d date;
  v_start date;
  v_guard int := 0;
begin
  select * into v_s from public.streaks where id = p_streak;
  if not found then return; end if;

  v_start := coalesce(v_s.last_processed_day + 1, (v_s.created_at at time zone 'utc')::date);
  if v_start > p_day then return; end if;

  v_d := v_start;
  while v_d <= p_day and v_guard < 400 loop
    perform public._streak_process_one(p_streak, v_d);
    v_d := v_d + 1;
    v_guard := v_guard + 1;
  end loop;

  update public.streaks set last_processed_day = greatest(coalesce(last_processed_day, p_day), p_day)
    where id = p_streak;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) DAILY PROCESSING ENTRY POINTS (cron + client fallback; mirrors 0003)
-- ─────────────────────────────────────────────────────────────────────────────

-- ALL streaks up to p_day (default = yesterday UTC, i.e. the window that just
-- closed). Run by pg_cron. Idempotent & race-safe. Returns streaks processed.
create or replace function public.process_streak_day(p_day date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'utc')::date - 1);
  v_id uuid;
  v_n int := 0;
begin
  for v_id in select id from public.streaks loop
    perform public._streak_advance(v_id, v_day);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Client safety net: process ONLY the caller's own streaks (so an authenticated
-- user can flush their own pending days on app launch without triggering global
-- work). Same idempotent core.
create or replace function public.process_my_streaks(p_day date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_day date := coalesce(p_day, (now() at time zone 'utc')::date - 1);
  v_id uuid;
  v_n int := 0;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  for v_id in select id from public.streaks where user_lo = v_me or user_hi = v_me loop
    perform public._streak_advance(v_id, v_day);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) READ RPCs (efficient; no N+1)
-- ─────────────────────────────────────────────────────────────────────────────

-- All of the caller's streaks with peer profile + today's live flags, in ONE
-- round-trip (drives the chat-list emojis with no per-row fetch).
create or replace function public.get_my_streaks()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        s.id                as streak_id,
        s.conversation_id,
        s.score,
        public.streak_tier(s.score) as tier,
        s.successful_days,
        peer.id             as peer_id,
        peer.username       as peer_username,
        peer.display_name   as peer_name,
        peer.avatar_url     as peer_avatar,
        coalesce(d.completed, false) as completed_today,
        -- did I qualify today / am I waiting on my peer?
        case when s.user_lo = v_me then coalesce(d.user_lo_qualified, false)
             else coalesce(d.user_hi_qualified, false) end as i_qualified_today,
        case when s.user_lo = v_me then coalesce(d.user_hi_qualified, false)
             else coalesce(d.user_lo_qualified, false) end as peer_qualified_today
      from public.streaks s
      join public.profiles peer
        on peer.id = case when s.user_lo = v_me then s.user_hi else s.user_lo end
      left join public.streak_days d on d.streak_id = s.id and d.day = v_day
      where (s.user_lo = v_me or s.user_hi = v_me)
        and (s.score > 0 or d.streak_id is not null)
      order by s.score desc
    ) t
  ), '[]'::json);
end;
$$;

-- One pair's detail + recent ledger events (Streak History).
create or replace function public.get_streak(p_conversation uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_conversation) then raise exception 'not a member'; end if;
  return (
    select json_build_object(
      'streak', (select row_to_json(x) from (
        select s.id as streak_id, s.conversation_id, s.score,
               public.streak_tier(s.score) as tier, s.successful_days,
               s.last_awarded_day, s.created_at
        from public.streaks s where s.conversation_id = p_conversation) x),
      'milestones', coalesce((select json_agg(row_to_json(m)) from (
        select kind, achieved_at, achieved_score, reward_granted, meta
        from public.streak_milestones sm
        join public.streaks s on s.id = sm.streak_id
        where s.conversation_id = p_conversation
        order by achieved_at desc) m), '[]'::json),
      'events', coalesce((select json_agg(row_to_json(e)) from (
        select ev.day, ev.delta, ev.old_score, ev.new_score, ev.reason, ev.created_at
        from public.streak_events ev
        join public.streaks s on s.id = ev.streak_id
        where s.conversation_id = p_conversation
        order by ev.created_at desc limit 60) e), '[]'::json)
    )
  );
end;
$$;

-- Hall of Legends — paginated legendary pairs (score-authoritative eligibility via
-- the immutable milestone). Keyset paginated by achieved_at. Profiles are readable
-- to authenticated users (0001), so both members resolve; achievement is preserved
-- even if the current score later drops.
create or replace function public.get_hall_of_legends(p_limit int default 50, p_before timestamptz default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        s.id as streak_id, sm.achieved_at, sm.achieved_score, s.score as current_score,
        public.streak_tier(s.score) as current_tier,
        a.id as user_a_id, a.username as user_a_username, a.display_name as user_a_name, a.avatar_url as user_a_avatar,
        b.id as user_b_id, b.username as user_b_username, b.display_name as user_b_name, b.avatar_url as user_b_avatar
      from public.streak_milestones sm
      join public.streaks s on s.id = sm.streak_id
      join public.profiles a on a.id = s.user_lo
      join public.profiles b on b.id = s.user_hi
      where sm.kind = 'hall_of_legends'
        and (p_before is null or sm.achieved_at < p_before)
      order by sm.achieved_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) t
  ), '[]'::json);
end;
$$;

-- Admin-only streak audit: milestones, rewards, moderator grants, Hall of Legends,
-- recent events. Read-only; reuses _require_admin (0013). Moderators get NO
-- score-write power anywhere in this system.
create or replace function public.admin_streak_audit(p_limit int default 200)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return json_build_object(
    'milestones', coalesce((select json_agg(row_to_json(m)) from (
      select sm.kind, sm.achieved_at, sm.achieved_score, sm.reward_granted, sm.meta,
             s.conversation_id, s.score as current_score, s.user_lo, s.user_hi
      from public.streak_milestones sm join public.streaks s on s.id = sm.streak_id
      order by sm.achieved_at desc limit least(coalesce(p_limit,200), 1000)) m), '[]'::json),
    'mod_grants', coalesce((select json_agg(row_to_json(g)) from (
      select a.target as moderator_id, a.meta, a.created_at
      from public.audit_log a where a.action = 'streak_assign_moderator'
      order by a.created_at desc limit 200) g), '[]'::json),
    'hall_of_legends', coalesce((select json_agg(row_to_json(h)) from (
      select s.conversation_id, s.user_lo, s.user_hi, sm.achieved_at, s.score as current_score
      from public.streak_milestones sm join public.streaks s on s.id = sm.streak_id
      where sm.kind = 'hall_of_legends' order by sm.achieved_at desc limit 200) h), '[]'::json),
    'recent_events', coalesce((select json_agg(row_to_json(e)) from (
      select ev.streak_id, ev.day, ev.delta, ev.old_score, ev.new_score, ev.reason, ev.created_at
      from public.streak_events ev order by ev.created_at desc limit least(coalesce(p_limit,200), 1000)) e), '[]'::json)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) RLS  (SELECT-only for members; ALL writes via SECURITY DEFINER fns above)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.streaks           enable row level security;
alter table public.streak_days       enable row level security;
alter table public.streak_events     enable row level security;
alter table public.streak_milestones enable row level security;

drop policy if exists "read member streaks" on public.streaks;
create policy "read member streaks" on public.streaks
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "read member streak_days" on public.streak_days;
create policy "read member streak_days" on public.streak_days
  for select to authenticated using (
    public.is_member((select conversation_id from public.streaks s where s.id = streak_id)));

drop policy if exists "read member streak_events" on public.streak_events;
create policy "read member streak_events" on public.streak_events
  for select to authenticated using (
    public.is_member((select conversation_id from public.streaks s where s.id = streak_id)));

drop policy if exists "read member streak_milestones" on public.streak_milestones;
create policy "read member streak_milestones" on public.streak_milestones
  for select to authenticated using (
    public.is_member((select conversation_id from public.streaks s where s.id = streak_id)));

-- No INSERT/UPDATE/DELETE policies ⇒ authenticated clients can never write these
-- tables directly. All mutations flow through the SECURITY DEFINER functions.

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
grant select on public.streaks, public.streak_days, public.streak_events, public.streak_milestones to authenticated;
grant execute on function public.streak_tier(int)                       to authenticated;
grant execute on function public.record_streak_activity(uuid)           to authenticated;
grant execute on function public.process_my_streaks(date)               to authenticated;
grant execute on function public.get_my_streaks()                       to authenticated;
grant execute on function public.get_streak(uuid)                       to authenticated;
grant execute on function public.get_hall_of_legends(int, timestamptz)  to authenticated;
grant execute on function public.admin_streak_audit(int)                to authenticated;
-- process_streak_day (global) is intentionally NOT granted to authenticated; it is
-- run by pg_cron (below) / service role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 12) REALTIME (drive live chat-list emoji + detail updates across devices)
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='streaks') then
    alter publication supabase_realtime add table public.streaks;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='streak_events') then
    alter publication supabase_realtime add table public.streak_events;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13) SCHEDULING (pg_cron; guarded — availability varies by plan)
-- ─────────────────────────────────────────────────────────────────────────────
-- Runs process_streak_day() shortly after 00:00 UTC so the just-closed day is
-- awarded/penalised without depending on any app being open. If pg_cron is not
-- available on this project, this block is a no-op and the app's launch-time
-- process_my_streaks() fallback keeps every pair correct (idempotent catch-up).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- unschedule an old copy if re-running, then (re)schedule.
    perform cron.unschedule(jobid) from cron.job where jobname = 'futurehat_process_streaks';
    perform cron.schedule('futurehat_process_streaks', '10 0 * * *',
                          $cron$ select public.process_streak_day(); $cron$);
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
