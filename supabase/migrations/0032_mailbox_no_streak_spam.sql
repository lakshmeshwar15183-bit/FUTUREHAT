-- 0032_mailbox_no_streak_spam.sql — stop the mailbox from being flooded with
-- daily streak notifications. The Mailbox is now reserved for real user-facing
-- notices (friend requests / warnings / mod grants / milestone rewards / etc.);
-- background streak progression, tier changes, and penalty updates run silently
-- and are visible only in the chat list emoji + Streak Detail screen.
-- ============================================================================
-- ADDITIVE + idempotent. Safe to re-run. Apply after 0031.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Replace _streak_process_one to STOP inserting mailbox entries for daily
--    awards, ordinary tier ups, and penalties. Milestone notifications
--    (Diamond / Moderator / Hall of Legends) are still fired by
--    _streak_check_milestones — those are lifetime-once rewards and belong in
--    the mailbox.
-- ─────────────────────────────────────────────────────────────────────────────
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
begin
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

  if v_completed and not v_awarded and coalesce(v_s.last_awarded_day, 'epoch') <> p_day then
    v_new := v_old + 1;
    update public.streaks
      set score = v_new, successful_days = successful_days + 1,
          last_awarded_day = p_day, updated_at = now()
      where id = p_streak;
    update public.streak_days set awarded = true, updated_at = now()
      where streak_id = p_streak and day = p_day;
    insert into public.streak_events (streak_id, day, delta, old_score, new_score, reason)
    values (p_streak, p_day, 1, v_old, v_new, 'daily_award');

    -- Milestones still fire ONCE per pair — Diamond / Mod / Hall of Legends —
    -- and _streak_check_milestones handles the mailbox delivery for those.
    perform public._streak_check_milestones(p_streak);

  elsif (not v_completed) and (not v_penalized) and p_day < v_today then
    v_new := greatest(0, v_old - 3);
    if v_new <> v_old then
      update public.streaks set score = v_new, updated_at = now() where id = p_streak;
      insert into public.streak_events (streak_id, day, delta, old_score, new_score, reason)
      values (p_streak, p_day, v_new - v_old, v_old, v_new, 'missed_penalty');
    end if;
    update public.streak_days set penalized = true, updated_at = now()
      where streak_id = p_streak and day = p_day;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Purge the existing streak-spam mailbox rows so users open the Mailbox to
--    a clean list. Milestones (Diamond / HoL / Moderator) are preserved: they
--    are lifetime-once, their titles do not match the daily-progression phrases,
--    and mod_appointed has a distinct `kind`.
-- ─────────────────────────────────────────────────────────────────────────────
delete from public.user_warnings
  where kind = 'info'
    and (
         title ilike '🔥 Streak +1%'
      or title ilike 'Tier up!%'
      or title ilike 'Tier changed%'
      or title ilike '💔 Streak penalty%'
    );
