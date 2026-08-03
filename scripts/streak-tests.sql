-- streak-tests.sql — self-contained assertions for the Lumixo Streak System
-- (migration 0029_streaks.sql). Runs entirely inside ONE transaction and ROLLS
-- BACK at the end, so it never mutates real data. Every check RAISEs EXCEPTION on
-- failure, so a non-zero exit / visible error means a regression.
--
-- Run (owner supplies the DB password, same pattern as apply-migrations.sh):
--   PGURL="postgresql://postgres.<ref>:<PW>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/streak-tests.sql
-- (No psql on this Mac? Paste into Supabase Studio → SQL Editor and Run. The final
--  ROLLBACK keeps it side-effect free.)
--
-- These tests call the internal helpers directly with explicit days so they don't
-- depend on wall-clock timing. They bypass RLS (run as the table owner), which is
-- correct here: RLS only gates the CLIENT; the security guarantee under test is
-- that scores/rewards are computed by the SECURITY DEFINER functions, never set by
-- clients — verified separately by the SELECT-only policies in the migration.

begin;
set local client_min_messages = warning;

-- ── Seed: two users + a direct conversation (the canonical pair) ───────────────
-- profiles FK → auth.users, so we insert both. gen_random_uuid from pgcrypto (0001).
do $$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();   -- a third user, for a second pair
  conv uuid := gen_random_uuid();
  conv2 uuid := gen_random_uuid();
  s public.streaks;
  s2 public.streaks;
  v_score int;
  v_days int;
  v_tier text;
  v_prem_end timestamptz;
  v_role text;
  v_cnt int;
  v_awarded boolean;
  d0 date := date '2026-01-01';
begin
  -- auth.users rows (minimal). instance_id/aud/role kept simple.
  insert into auth.users (id, email) values
    (u_a, 'streaktest_a_'||u_a||'@example.com'),
    (u_b, 'streaktest_b_'||u_b||'@example.com'),
    (u_c, 'streaktest_c_'||u_c||'@example.com');
  -- profiles (handle_new_user may already create them via trigger; upsert to be safe)
  insert into public.profiles (id, username, display_name, role) values
    (u_a, 'stest_a_'||substr(u_a::text,1,8), 'Streak A', 'user'),
    (u_b, 'stest_b_'||substr(u_b::text,1,8), 'Streak B', 'user'),
    (u_c, 'stest_c_'||substr(u_c::text,1,8), 'Streak C', 'user')
  on conflict (id) do update set role = 'user';

  insert into public.conversations (id, type, created_by) values (conv, 'direct', u_a);
  insert into public.conversation_participants (conversation_id, user_id) values (conv, u_a), (conv, u_b);

  -- ── T1: word count — 4 words does NOT qualify, 5 words does ──────────────────
  if public._streak_word_count('one two three four') <> 4 then
    raise exception 'T1a word_count(4) wrong'; end if;
  if public._streak_word_count('one two three four') >= 5 then
    raise exception 'T1b 4-word message must NOT qualify'; end if;
  if public._streak_word_count('one two three four five') <> 5 then
    raise exception 'T1c word_count(5) wrong'; end if;
  -- punctuation-only tokens don't count as words
  if public._streak_word_count('hi . . . .') <> 1 then
    raise exception 'T1d punctuation must not count as words'; end if;

  -- ── T2: five separate one-word messages do NOT combine ───────────────────────
  insert into public.messages (conversation_id, sender_id, type, content, created_at) values
    (conv, u_a, 'text', 'one',   (d0::timestamp at time zone 'utc')),
    (conv, u_a, 'text', 'two',   (d0::timestamp at time zone 'utc')),
    (conv, u_a, 'text', 'three', (d0::timestamp at time zone 'utc')),
    (conv, u_a, 'text', 'four',  (d0::timestamp at time zone 'utc')),
    (conv, u_a, 'text', 'five',  (d0::timestamp at time zone 'utc'));
  if public._streak_user_qualified(conv, u_a, d0) then
    raise exception 'T2 five 1-word messages must NOT qualify'; end if;

  -- ── T3: one 5-word message qualifies; deleted message does not ───────────────
  insert into public.messages (conversation_id, sender_id, type, content, created_at)
    values (conv, u_a, 'text', 'hello there my good friend', (d0::timestamp at time zone 'utc'));
  if not public._streak_user_qualified(conv, u_a, d0) then
    raise exception 'T3a 5-word message must qualify'; end if;

  -- a deleted photo must not qualify user B
  insert into public.messages (conversation_id, sender_id, type, media_url, is_deleted, created_at)
    values (conv, u_b, 'image', 'x/y.jpg', true, (d0::timestamp at time zone 'utc'));
  if public._streak_user_qualified(conv, u_b, d0) then
    raise exception 'T3b deleted photo must NOT qualify'; end if;

  -- ── T4: photo qualifies user B ───────────────────────────────────────────────
  insert into public.messages (conversation_id, sender_id, type, media_url, created_at)
    values (conv, u_b, 'image', 'x/real.jpg', (d0::timestamp at time zone 'utc'));
  if not public._streak_user_qualified(conv, u_b, d0) then
    raise exception 'T4 photo must qualify'; end if;

  -- ── T5: award +1 exactly once for a mutually-completed day ───────────────────
  s := public._streak_get_or_create(conv);
  perform public._streak_process_one(s.id, d0);
  select score, successful_days into v_score, v_days from public.streaks where id = s.id;
  if v_score <> 1 then raise exception 'T5a expected score 1, got %', v_score; end if;
  if v_days <> 1 then raise exception 'T5b expected 1 successful day, got %', v_days; end if;
  -- idempotent: re-run same day must not double-award
  perform public._streak_process_one(s.id, d0);
  select score into v_score from public.streaks where id = s.id;
  if v_score <> 1 then raise exception 'T5c re-processing changed score to %', v_score; end if;

  -- ── T6: one-sided activity (100 msgs from A, nothing from B) → NO +1 award ────
  -- day d0+1: A sends many qualifying messages, B sends nothing. The pair must NOT
  -- receive the daily +1 (spec). (Because the day is past & not mutually completed,
  -- it is a missed day and is penalised instead — that's correct; here we assert
  -- specifically that NO AWARD was granted.)
  insert into public.messages (conversation_id, sender_id, type, content, created_at)
    select conv, u_a, 'text', 'this is a valid five word message', ((d0+1)::timestamp at time zone 'utc')
    from generate_series(1, 100);
  perform public._streak_process_one(s.id, d0+1);
  -- the day must not be marked awarded, and no daily_award event may exist for it
  select awarded into v_awarded from public.streak_days where streak_id = s.id and day = d0+1;
  if coalesce(v_awarded, false) then raise exception 'T6a one-sided day was marked awarded'; end if;
  select count(*) into v_cnt from public.streak_events
    where streak_id = s.id and day = d0+1 and reason = 'daily_award';
  if v_cnt <> 0 then raise exception 'T6b one-sided activity produced a +1 award event'; end if;
  -- reset to a known score for the following call-day test
  update public.streaks set score = 1, last_awarded_day = d0 where id = s.id;
  delete from public.streak_days where streak_id = s.id and day = d0+1;

  -- ── T7: connected-call duration rules ────────────────────────────────────────
  -- exactly 15s must NOT qualify (must be > 15s); 16s connected must qualify.
  insert into public.calls (conversation_id, caller_id, type, status, started_at, answered_at, ended_at)
    values (conv, u_a, 'audio', 'ended',
            (d0+2)::timestamp at time zone 'utc',
            ((d0+2)::timestamp + interval '5 seconds') at time zone 'utc',
            ((d0+2)::timestamp + interval '20 seconds') at time zone 'utc');  -- 15s connected
  if public._streak_user_qualified(conv, u_a, d0+2) then
    raise exception 'T7a 15s call must NOT qualify (needs >15s)'; end if;
  -- a missed call (answered_at null) must not qualify
  insert into public.calls (conversation_id, caller_id, type, status, started_at)
    values (conv, u_b, 'audio', 'missed', (d0+2)::timestamp at time zone 'utc');
  if public._streak_user_qualified(conv, u_b, d0+2) then
    raise exception 'T7b missed call must NOT qualify'; end if;
  -- 16s connected call qualifies BOTH members (a call is mutual)
  insert into public.calls (conversation_id, caller_id, type, status, started_at, answered_at, ended_at)
    values (conv, u_a, 'video', 'ended',
            (d0+2)::timestamp at time zone 'utc',
            ((d0+2)::timestamp + interval '5 seconds') at time zone 'utc',
            ((d0+2)::timestamp + interval '21 seconds') at time zone 'utc');  -- 16s connected
  if not public._streak_user_qualified(conv, u_a, d0+2) then
    raise exception 'T7c 16s connected call must qualify caller'; end if;
  if not public._streak_user_qualified(conv, u_b, d0+2) then
    raise exception 'T7d 16s connected call must qualify callee (mutual)'; end if;
  perform public._streak_process_one(s.id, d0+2);
  select score into v_score from public.streaks where id = s.id;
  if v_score <> 2 then raise exception 'T7e expected score 2 after call day, got %', v_score; end if;

  -- ── T8: missed day → −3, floored at 0 ────────────────────────────────────────
  -- Force a high score, then process a missed past day.
  update public.streaks set score = 2, last_processed_day = d0+2 where id = s.id;
  -- d0+3 has no activity from either side and is in the past → penalty
  perform public._streak_process_one(s.id, d0+3);
  select score into v_score from public.streaks where id = s.id;
  if v_score <> 0 then raise exception 'T8a expected floor 0 after -3 from 2, got %', v_score; end if;
  -- penalty is idempotent
  perform public._streak_process_one(s.id, d0+3);
  select score into v_score from public.streaks where id = s.id;
  if v_score <> 0 then raise exception 'T8b penalty not idempotent (%).', v_score; end if;

  -- ── T9: tier mapping incl. 100 💜 → 97 ❤️ demotion ───────────────────────────
  if public.streak_tier(0)   <> ''   then raise exception 'T9 tier(0)'; end if;
  if public.streak_tier(16)  <> '🎏' then raise exception 'T9 tier(16)'; end if;
  if public.streak_tier(17)  <> '💙' then raise exception 'T9 tier(17)'; end if;
  if public.streak_tier(99)  <> '❤️' then raise exception 'T9 tier(99)'; end if;
  if public.streak_tier(100) <> '💜' then raise exception 'T9 tier(100)'; end if;
  if public.streak_tier(97)  <> '❤️' then raise exception 'T9 demotion 100→97 tier wrong'; end if;
  if public.streak_tier(365) <> '💎' then raise exception 'T9 tier(365) diamond'; end if;
  if public.streak_tier(366) <> '🪙' then raise exception 'T9 tier(366)'; end if;
  if public.streak_tier(730) <> '🏆' then raise exception 'T9 tier(730) hall'; end if;

  -- ── T10: Diamond at 365 grants premium ONCE; safe-extend never shortens ──────
  -- Give user A a LONG existing subscription, then trigger Diamond; the month must
  -- be ADDED (extend from the later of now()/existing), never shorten it.
  insert into public.subscriptions (user_id, plan, status, provider, current_period_start, current_period_end)
    values (u_a, 'yearly', 'active', 'manual', now(), now() + interval '300 days')
    on conflict (user_id) do update set current_period_end = now() + interval '300 days', status='active';
  update public.streaks set score = 365 where id = s.id;
  perform public._streak_check_milestones(s.id);
  select count(*) into v_cnt from public.streak_milestones where streak_id = s.id and kind = 'diamond';
  if v_cnt <> 1 then raise exception 'T10a expected 1 diamond milestone, got %', v_cnt; end if;
  select current_period_end into v_prem_end from public.subscriptions where user_id = u_a;
  if v_prem_end < now() + interval '300 days' then
    raise exception 'T10b diamond reward SHORTENED an existing subscription (%).', v_prem_end; end if;
  if v_prem_end < now() + interval '329 days' then
    raise exception 'T10c diamond reward did not ADD a month on top (%).', v_prem_end; end if;
  -- user B had no sub → should now have ~1 month
  if not public.is_premium(u_b) then raise exception 'T10d diamond did not grant premium to B'; end if;
  -- re-trigger after "losing and regaining": must NOT grant again (anti-farming)
  update public.streaks set score = 100 where id = s.id;  -- simulate loss
  update public.streaks set score = 365 where id = s.id;  -- simulate regain
  perform public._streak_check_milestones(s.id);
  select count(*) into v_cnt from public.streak_milestones where streak_id = s.id and kind = 'diamond';
  if v_cnt <> 1 then raise exception 'T10e diamond re-granted (farming!) count=%', v_cnt; end if;

  -- ── T11: 367 → exactly ONE member becomes moderator; owner/admin untouched ────
  update public.streaks set score = 367 where id = s.id;
  perform public._streak_check_milestones(s.id);
  select count(*) into v_cnt from public.profiles where id in (u_a, u_b) and role = 'moderator';
  if v_cnt <> 1 then raise exception 'T11a expected exactly 1 moderator, got %', v_cnt; end if;
  -- deterministic: user_lo is the candidate
  select role into v_role from public.profiles where id = least(u_a, u_b);
  if v_role <> 'moderator' then raise exception 'T11b deterministic candidate (user_lo) not moderator'; end if;
  -- an audit row was written
  select count(*) into v_cnt from public.audit_log where action = 'streak_assign_moderator' and target = least(u_a,u_b)::text;
  if v_cnt < 1 then raise exception 'T11c no audit row for moderator assignment'; end if;
  -- re-run: no duplicate moderator, no duplicate milestone
  perform public._streak_check_milestones(s.id);
  select count(*) into v_cnt from public.streak_milestones where streak_id = s.id and kind = 'mod_eligible';
  if v_cnt <> 1 then raise exception 'T11d mod_eligible milestone duplicated (%).', v_cnt; end if;

  -- ── T12: Hall of Legends at 730 once; survives later score drop ──────────────
  update public.streaks set score = 730 where id = s.id;
  perform public._streak_check_milestones(s.id);
  update public.streaks set score = 400 where id = s.id;  -- score drops
  perform public._streak_check_milestones(s.id);
  select count(*) into v_cnt from public.streak_milestones where streak_id = s.id and kind = 'hall_of_legends';
  if v_cnt <> 1 then raise exception 'T12a expected exactly 1 hall_of_legends, got %', v_cnt; end if;

  -- ── T13: archive + lock do NOT change the score ──────────────────────────────
  -- These are separate per-user tables; the streak keys off conversation_id and
  -- never reads them, so writing them cannot move the score. locked_conversations
  -- (0027) is optional here — only exercised if the table is present.
  select score into v_score from public.streaks where id = s.id;
  insert into public.archived_conversations (user_id, conversation_id) values (u_b, conv) on conflict do nothing;
  if to_regclass('public.locked_conversations') is not null then
    insert into public.locked_conversations (user_id, conversation_id) values (u_a, conv) on conflict do nothing;
  end if;
  select score into v_cnt from public.streaks where id = s.id;  -- reuse v_cnt as "after"
  if v_score <> v_cnt then raise exception 'T13 archive/lock changed the score (% → %)', v_score, v_cnt; end if;

  -- ── T14: canonical pair identity — no duplicate streak for the same pair ─────
  s2 := public._streak_get_or_create(conv);   -- same conversation again
  if s2.id <> s.id then raise exception 'T14 duplicate streak row for same pair'; end if;

  raise notice 'ALL STREAK TESTS PASSED ✔ (final score for pair = %)', (select score from public.streaks where id = s.id);
end $$;

rollback;
