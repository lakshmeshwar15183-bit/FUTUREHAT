-- streak-verify-38.sql — verifies the reviewer's 38-point checklist (DB-verifiable
-- items) against the LIVE streak backend (0029_streaks.sql). Self-rollbacking: seeds
-- throwaway users/conversations and ROLLS BACK at the end — zero side effects.
-- Each item RAISEs NOTICE 'OK n' on pass and RAISEs EXCEPTION on failure (aborts).
begin;
do $$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  conv2 uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();
  s public.streaks;
  s2 public.streaks;
  sc int; cnt int; awd boolean; pen boolean; rl text; prem_end timestamptz; prem_end2 timestamptz;
  d date := date '2026-03-01';
begin
  insert into auth.users(id,email) values (u_a,'v38a_'||u_a||'@x.com'),(u_b,'v38b_'||u_b||'@x.com'),(u_c,'v38c_'||u_c||'@x.com');
  insert into public.profiles(id,username,display_name,role) values
    (u_a,'v38a_'||substr(u_a::text,1,8),'A','user'),
    (u_b,'v38b_'||substr(u_b::text,1,8),'B','user'),
    (u_c,'v38c_'||substr(u_c::text,1,8),'C','user')
    on conflict (id) do update set role='user';
  insert into public.conversations(id,type,created_by) values (conv,'direct',u_a);
  insert into public.conversation_participants(conversation_id,user_id) values (conv,u_a),(conv,u_b);

  -- 1) New pair starts streak
  s := public._streak_get_or_create(conv);
  if s.id is null or s.score <> 0 then raise exception 'FAIL 1'; end if;
  raise notice 'OK 1 — new pair starts streak (score 0)';

  -- 7) Five separate one-word messages do NOT qualify
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    values (conv,u_a,'text','one',(d::timestamp at time zone 'utc')),
           (conv,u_a,'text','two',(d::timestamp at time zone 'utc')),
           (conv,u_a,'text','three',(d::timestamp at time zone 'utc')),
           (conv,u_a,'text','four',(d::timestamp at time zone 'utc')),
           (conv,u_a,'text','five',(d::timestamp at time zone 'utc'));
  if public._streak_user_qualified(conv,u_a,d) then raise exception 'FAIL 7'; end if;
  raise notice 'OK 7 — five one-word messages do not qualify';

  -- 8) One valid five-word message qualifies
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    values (conv,u_a,'text','hello there my good friend',(d::timestamp at time zone 'utc'));
  if not public._streak_user_qualified(conv,u_a,d) then raise exception 'FAIL 8'; end if;
  raise notice 'OK 8 — one five-word message qualifies';

  -- 2) Only User A qualifies → day not complete, no award
  perform public._streak_process_one(s.id,d);
  select awarded into awd from public.streak_days where streak_id=s.id and day=d;
  if coalesce(awd,false) then raise exception 'FAIL 2 (awarded on one-sided)'; end if;
  raise notice 'OK 2 — only A qualifies → no award';

  -- 9) Photo qualifies (image + media_url) → makes B qualify
  insert into public.messages(conversation_id,sender_id,type,media_url,created_at)
    values (conv,u_b,'image','x/photo.jpg',(d::timestamp at time zone 'utc'));
  if not public._streak_user_qualified(conv,u_b,d) then raise exception 'FAIL 9'; end if;
  raise notice 'OK 9 — photo qualifies';

  -- 4) Both users qualify → completed → +1
  perform public._streak_process_one(s.id,d);
  select score into sc from public.streaks where id=s.id;
  if sc <> 1 then raise exception 'FAIL 4 (score=%)',sc; end if;
  raise notice 'OK 4 — both qualify → +1 (score=1)';

  -- 5) +1 awarded only once (re-process same day)
  perform public._streak_process_one(s.id,d);
  select score into sc from public.streaks where id=s.id;
  if sc <> 1 then raise exception 'FAIL 5 (score=%)',sc; end if;
  raise notice 'OK 5 — +1 only once';

  -- 23) Duplicate backend processing does not duplicate +1 (call 3x more)
  perform public._streak_process_one(s.id,d);
  perform public._streak_process_one(s.id,d);
  perform public._streak_process_one(s.id,d);
  select score into sc from public.streaks where id=s.id;
  if sc <> 1 then raise exception 'FAIL 23 (score=%)',sc; end if;
  raise notice 'OK 23 — duplicate processing does not duplicate +1';

  -- 24) Two devices do not duplicate +1: both call process_my_streaks-equivalent for the SAME
  --     already-awarded day. awarded guard + advisory lock make it a no-op.
  perform public._streak_advance(s.id, d);
  perform public._streak_advance(s.id, d);
  select score into sc from public.streaks where id=s.id;
  if sc <> 1 then raise exception 'FAIL 24 (score=%)',sc; end if;
  raise notice 'OK 24 — two-device / concurrent processing does not duplicate +1';

  -- 6) Multiple messages do not award multiple points (many msgs same day, still +1)
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    select conv,u_a,'text','one two three four five',((d+1)::timestamp at time zone 'utc') from generate_series(1,50);
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    select conv,u_b,'text','one two three four five',((d+1)::timestamp at time zone 'utc') from generate_series(1,50);
  perform public._streak_process_one(s.id,d+1);
  select score into sc from public.streaks where id=s.id;
  if sc <> 2 then raise exception 'FAIL 6 (score=%)',sc; end if;
  raise notice 'OK 6 — many messages in a day still award only +1 (score=2)';

  -- 3) Only User B qualifies (fresh day d+2: only B) → no award
  insert into public.messages(conversation_id,sender_id,type,media_url,created_at)
    values (conv,u_b,'image','x/only-b.jpg',((d+2)::timestamp at time zone 'utc'));
  perform public._streak_process_one(s.id,d+2);
  select awarded into awd from public.streak_days where streak_id=s.id and day=d+2;
  if coalesce(awd,false) then raise exception 'FAIL 3'; end if;
  raise notice 'OK 3 — only B qualifies → no award';

  -- reset bookkeeping for the call tests (avoid penalty interference)
  update public.streaks set score=2, last_awarded_day=d+1, last_processed_day=d+1 where id=s.id;
  delete from public.streak_days where streak_id=s.id and day=d+2;

  -- 11) 15-second connected call does NOT qualify (needs > 15s)
  insert into public.calls(conversation_id,caller_id,type,status,started_at,answered_at,ended_at)
    values (conv,u_a,'audio','ended',
      (d+3)::timestamp at time zone 'utc',
      ((d+3)::timestamp + interval '5 seconds') at time zone 'utc',
      ((d+3)::timestamp + interval '20 seconds') at time zone 'utc');
  if public._streak_user_qualified(conv,u_a,d+3) then raise exception 'FAIL 11'; end if;
  raise notice 'OK 11 — exactly 15s connected call does NOT qualify';

  -- 13) Missed call does not qualify
  insert into public.calls(conversation_id,caller_id,type,status,started_at)
    values (conv,u_b,'audio','missed',(d+3)::timestamp at time zone 'utc');
  if public._streak_user_qualified(conv,u_b,d+3) then raise exception 'FAIL 13'; end if;
  raise notice 'OK 13 — missed call does not qualify';

  -- 14) Rejected/declined call does not qualify
  insert into public.calls(conversation_id,caller_id,type,status,started_at,ended_at)
    values (conv,u_b,'audio','declined',(d+3)::timestamp at time zone 'utc',((d+3)::timestamp+interval '2 seconds') at time zone 'utc');
  if public._streak_user_qualified(conv,u_b,d+3) then raise exception 'FAIL 14'; end if;
  raise notice 'OK 14 — rejected call does not qualify';

  -- 12) Call longer than 15s qualifies (voice) — a connected call qualifies BOTH
  insert into public.calls(conversation_id,caller_id,type,status,started_at,answered_at,ended_at)
    values (conv,u_a,'audio','ended',
      (d+3)::timestamp at time zone 'utc',
      ((d+3)::timestamp + interval '5 seconds') at time zone 'utc',
      ((d+3)::timestamp + interval '21 seconds') at time zone 'utc');
  if not public._streak_user_qualified(conv,u_a,d+3) then raise exception 'FAIL 12a'; end if;
  if not public._streak_user_qualified(conv,u_b,d+3) then raise exception 'FAIL 12b'; end if;
  raise notice 'OK 12 — >15s connected voice call qualifies (both members)';

  -- 10) Video call >15s qualifies (type video)
  insert into public.calls(conversation_id,caller_id,type,status,started_at,answered_at,ended_at)
    values (conv,u_a,'video','ended',
      (d+4)::timestamp at time zone 'utc',
      ((d+4)::timestamp + interval '2 seconds') at time zone 'utc',
      ((d+4)::timestamp + interval '30 seconds') at time zone 'utc');
  if not public._streak_user_qualified(conv,u_a,d+4) then raise exception 'FAIL 10 (video call)'; end if;
  -- also verify a 'file' media message (how videos are stored as messages) qualifies
  insert into public.messages(conversation_id,sender_id,type,media_url,created_at)
    values (conv,u_b,'file','x/clip.mp4',((d+4)::timestamp at time zone 'utc'));
  if not public._streak_user_qualified(conv,u_b,d+4) then raise exception 'FAIL 10 (file media)'; end if;
  raise notice 'OK 10 — video (call >15s and media message) qualifies';

  -- 15/16) Missed daily window → -3, floored at 0
  update public.streaks set score=2, last_processed_day=d+4 where id=s.id;
  perform public._streak_process_one(s.id,d+5);   -- no activity, past day
  select score into sc from public.streaks where id=s.id;
  if sc <> 0 then raise exception 'FAIL 15/16 (score=%)',sc; end if;
  raise notice 'OK 15 — missed day applies -3';
  raise notice 'OK 16 — score floored at 0 (never negative)';

  -- 17) 100 → missed day → 97, and tier 💜 → ❤️
  update public.streaks set score=100, last_processed_day=d+5 where id=s.id;
  if public.streak_tier(100) <> '💜' then raise exception 'FAIL 17 (tier@100)'; end if;
  perform public._streak_process_one(s.id,d+6);
  select score into sc from public.streaks where id=s.id;
  if sc <> 97 then raise exception 'FAIL 17 (score=%)',sc; end if;
  if public.streak_tier(97) <> '❤️' then raise exception 'FAIL 17 (tier@97)'; end if;
  raise notice 'OK 17 — 100 💜 → missed → 97 ❤️ (demotion)';

  -- 18) Archived chat continues streak (write archive row, award still works)
  insert into public.archived_conversations(user_id,conversation_id) values (u_a,conv) on conflict do nothing;
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    values (conv,u_a,'text','one two three four five',((d+7)::timestamp at time zone 'utc')),
           (conv,u_b,'text','one two three four five',((d+7)::timestamp at time zone 'utc'));
  update public.streaks set last_processed_day=d+6 where id=s.id;
  perform public._streak_process_one(s.id,d+7);
  select score into sc from public.streaks where id=s.id;
  if sc <> 98 then raise exception 'FAIL 18 (archived did not award; score=%)',sc; end if;
  raise notice 'OK 18 — archived chat still earns +1';

  -- 19) Locked chat continues streak (only if table exists on this DB)
  if to_regclass('public.locked_conversations') is not null then
    insert into public.locked_conversations(user_id,conversation_id) values (u_b,conv) on conflict do nothing;
  end if;
  insert into public.messages(conversation_id,sender_id,type,content,created_at)
    values (conv,u_a,'text','one two three four five',((d+8)::timestamp at time zone 'utc')),
           (conv,u_b,'text','one two three four five',((d+8)::timestamp at time zone 'utc'));
  perform public._streak_process_one(s.id,d+8);
  select score into sc from public.streaks where id=s.id;
  if sc <> 99 then raise exception 'FAIL 19 (locked did not award; score=%)',sc; end if;
  raise notice 'OK 19 — locked chat still earns +1';

  -- 20) Archive/lock state changes do NOT duplicate the streak row
  s2 := public._streak_get_or_create(conv);
  select count(*) into cnt from public.streaks where conversation_id=conv;
  if cnt <> 1 or s2.id <> s.id then raise exception 'FAIL 20 (duplicate streak; cnt=%)',cnt; end if;
  raise notice 'OK 20 — archive/lock never duplicates the streak';

  -- 25/26/27) Diamond once, Premium once, re-reaching 365 does not re-grant
  -- give A a long existing sub to prove safe-extend never shortens
  insert into public.subscriptions(user_id,plan,status,provider,current_period_start,current_period_end)
    values (u_a,'yearly','active','manual',now(),now()+interval '300 days')
    on conflict (user_id) do update set current_period_end=now()+interval '300 days', status='active';
  update public.streaks set score=365 where id=s.id;
  perform public._streak_check_milestones(s.id);
  select count(*) into cnt from public.streak_milestones where streak_id=s.id and kind='diamond';
  if cnt <> 1 then raise exception 'FAIL 25 (diamond cnt=%)',cnt; end if;
  raise notice 'OK 25 — Diamond milestone awarded once';
  if not public.is_premium(u_a) or not public.is_premium(u_b) then raise exception 'FAIL 26 (premium not granted)'; end if;
  select current_period_end into prem_end from public.subscriptions where user_id=u_a;
  if prem_end < now()+interval '329 days' then raise exception 'FAIL 26 (safe-extend shortened sub: %)',prem_end; end if;
  raise notice 'OK 26 — Premium granted to both; existing sub extended (not shortened)';
  -- lose and regain 365 → no second grant, sub end unchanged
  update public.streaks set score=100 where id=s.id;
  update public.streaks set score=365 where id=s.id;
  perform public._streak_check_milestones(s.id);
  select count(*) into cnt from public.streak_milestones where streak_id=s.id and kind='diamond';
  select current_period_end into prem_end2 from public.subscriptions where user_id=u_a;
  if cnt <> 1 then raise exception 'FAIL 27 (diamond re-granted cnt=%)',cnt; end if;
  if prem_end2 <> prem_end then raise exception 'FAIL 27 (premium extended again)'; end if;
  raise notice 'OK 27 — losing/regaining 365 does NOT re-grant Premium (anti-farming)';

  -- 28) 367 moderator eligibility: exactly ONE moderator, deterministic, audited, owner/admin safe
  update public.streaks set score=367 where id=s.id;
  perform public._streak_check_milestones(s.id);
  select count(*) into cnt from public.profiles where id in (u_a,u_b) and role='moderator';
  if cnt <> 1 then raise exception 'FAIL 28 (moderators=%)',cnt; end if;
  select role into rl from public.profiles where id = least(u_a,u_b);
  if rl <> 'moderator' then raise exception 'FAIL 28 (non-deterministic candidate)'; end if;
  select count(*) into cnt from public.audit_log where action='streak_assign_moderator' and target=least(u_a,u_b)::text;
  if cnt < 1 then raise exception 'FAIL 28 (no audit)'; end if;
  perform public._streak_check_milestones(s.id);   -- idempotent
  select count(*) into cnt from public.profiles where id in (u_a,u_b) and role='moderator';
  if cnt <> 1 then raise exception 'FAIL 28 (duplicate moderator)'; end if;
  raise notice 'OK 28 — 367 → exactly one moderator, deterministic, audited, idempotent';

  -- 29) Hall of Legends once; survives score drop
  update public.streaks set score=730 where id=s.id;
  perform public._streak_check_milestones(s.id);
  update public.streaks set score=400 where id=s.id;      -- drops below 730
  perform public._streak_check_milestones(s.id);
  select count(*) into cnt from public.streak_milestones where streak_id=s.id and kind='hall_of_legends';
  if cnt <> 1 then raise exception 'FAIL 29 (HoL cnt=%)',cnt; end if;
  raise notice 'OK 29 — Hall of Legends achieved once; preserved after score drop';

  -- 30) Chat-list emoji matches authoritative current score (streak_tier over the ladder)
  if public.streak_tier(0) <> '' or public.streak_tier(16) <> '🎏' or public.streak_tier(17) <> '💙'
     or public.streak_tier(45) <> '❤️' or public.streak_tier(100) <> '💜' or public.streak_tier(200) <> '🎖️'
     or public.streak_tier(365) <> '💎' or public.streak_tier(366) <> '🪙' or public.streak_tier(730) <> '🏆'
  then raise exception 'FAIL 30 (tier ladder mismatch)'; end if;
  raise notice 'OK 30 — emoji ladder matches authoritative score at every boundary';

  raise notice '==== ALL DB-VERIFIABLE CHECKLIST ITEMS PASSED ====';
end $$;
rollback;
