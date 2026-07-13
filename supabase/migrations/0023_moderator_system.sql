-- 0023_moderator_system.sql — Moderator System (Phase 1).
-- ============================================================================
-- ADDITIVE ONLY + idempotent. Builds the production surround around the
-- already-functional role machinery (0013) and reports surface (0017):
--   • Turns user_warnings into a general user MAILBOX (kind/title/reason) and
--     gives every user a read API + unseen badge — the table was written by
--     admin_warn_user (0017) but never surfaced to users.
--   • Structured moderator WARNINGS (fixed reason vocabulary + note), delivered
--     to the target's mailbox and permanently recorded (moderator id + time).
--   • Report ESCALATION to admin (flag columns; the status CHECK is untouched).
--   • Modular assign/remove-moderator RPCs that wrap {role change + mailbox
--     notification + audit} in ONE server call — the Admin panel calls these
--     now, and a future eligibility system (Hall of Legends…) can call the same
--     entry point without a rewrite. admin_set_role (0013) is left intact.
--   • admin_moderator_audit(): admin-only view of the append-only audit_log
--     filtered to moderator actions (immutable — audit_log has no UPDATE/DELETE
--     policy and is only written by SECURITY DEFINER _audit()).
--
-- Reuses from 0013: is_moderator / _require_moderator_or_admin / _require_admin /
-- _audit() / _guard_owner_target. Reuses from 0017: user_warnings, reports RPCs.
-- Apply after 0022. Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) MAILBOX — extend user_warnings (0017) into a general notification store
-- ─────────────────────────────────────────────────────────────────────────────
-- New columns are nullable / defaulted so existing admin_warn_user rows stay
-- valid. 'warning' preserves the historical meaning of the table.
alter table public.user_warnings add column if not exists kind   text not null default 'warning';
alter table public.user_warnings add column if not exists title  text;
alter table public.user_warnings add column if not exists reason text;

alter table public.user_warnings drop constraint if exists user_warnings_kind_check;
alter table public.user_warnings add constraint user_warnings_kind_check
  check (kind in ('warning','mod_appointed','mod_removed','info'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) REPORT ESCALATION — additive columns (status vocabulary unchanged)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.reports add column if not exists escalated     boolean not null default false;
alter table public.reports add column if not exists escalated_at   timestamptz;
alter table public.reports add column if not exists escalated_note text;
alter table public.reports add column if not exists escalated_by   uuid references auth.users(id) on delete set null;
create index if not exists idx_reports_escalated on public.reports(escalated) where escalated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) STRUCTURED MODERATOR WARNING
-- ─────────────────────────────────────────────────────────────────────────────
-- Moderator-or-admin gated. Reason validated against the fixed moderator list
-- (kept in sync with shared/types.ts WARNING_REASONS). Delivers an official
-- warning to the target's mailbox and records it permanently with moderator id,
-- timestamp and reason (req 5 + 7). Owner targets are protected.
create or replace function public.issue_warning(
  p_target uuid,
  p_reason text,
  p_note   text default null,
  p_report uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_moderator_or_admin();
  perform public._guard_owner_target(p_target);
  if p_reason not in ('spam','harassment','fake_profile','hate_speech',
                      'scam_fraud','inappropriate_content','other') then
    raise exception 'invalid warning reason %', p_reason;
  end if;
  insert into public.user_warnings (user_id, kind, title, reason, message, report_id, created_by)
  values (
    p_target, 'warning', 'Official Lumixo Warning', p_reason,
    coalesce(nullif(trim(coalesce(p_note,'')),''),
             'You have received an official warning for: ' || p_reason),
    p_report, auth.uid()
  ) returning id into v_id;
  perform public._audit('issue_warning', p_target::text,
    jsonb_build_object('reason', p_reason, 'note', p_note, 'report', p_report));
  return v_id;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) MODULAR ASSIGN / REMOVE MODERATOR  (single entry point; future-compatible)
-- ─────────────────────────────────────────────────────────────────────────────
-- assign_moderator wraps {role='moderator' + mailbox appointment + audit}. It is
-- admin-gated now; a future eligibility system can call the SAME function. Owner
-- and existing admins are never demoted by an assignment.
create or replace function public.assign_moderator(p_target uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  perform public._require_admin();
  perform public._guard_owner_target(p_target);
  select role into v_old from public.profiles where id = p_target;
  if v_old is null then raise exception 'user not found'; end if;
  -- Never downgrade an owner/admin; promoting a plain user (or re-affirming).
  if v_old not in ('admin','owner') then
    update public.profiles set role = 'moderator' where id = p_target;
  end if;
  insert into public.user_warnings (user_id, kind, title, message, created_by)
  values (p_target, 'mod_appointed', 'You are now a Lumixo Moderator',
          'You have been appointed as an official Lumixo Moderator. The Moderator Dashboard is now available in your Settings.',
          auth.uid());
  perform public._audit('assign_moderator', p_target::text,
    jsonb_build_object('from', v_old, 'to', 'moderator'));
end; $$;

-- remove_moderator reverses it (only downgrades an actual moderator → user).
create or replace function public.remove_moderator(p_target uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  perform public._require_admin();
  perform public._guard_owner_target(p_target);
  select role into v_old from public.profiles where id = p_target;
  if v_old is null then raise exception 'user not found'; end if;
  if v_old = 'moderator' then
    update public.profiles set role = 'user' where id = p_target;
  end if;
  insert into public.user_warnings (user_id, kind, title, message, created_by)
  values (p_target, 'mod_removed', 'Moderator role removed',
          'Your Lumixo Moderator role has been removed. Thank you for your service.',
          auth.uid());
  perform public._audit('remove_moderator', p_target::text,
    jsonb_build_object('from', v_old, 'to', 'user'));
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) ESCALATE A REPORT TO ADMIN
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mod_escalate_report(
  p_report uuid,
  p_note   text default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public._require_moderator_or_admin();
  update public.reports
     set escalated = true, escalated_at = now(), escalated_by = auth.uid(),
         escalated_note = p_note, status = 'reviewing'
   where id = p_report;
  if not found then raise exception 'report not found'; end if;
  perform public._audit('escalate_report', p_report::text,
    jsonb_build_object('note', p_note));
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) USER MAILBOX READ API  (every user reads their own; RLS already scopes it)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_mailbox(p_limit int default 100)
returns json language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select w.id, w.kind, w.title, w.reason, w.message, w.report_id,
             w.created_by, w.seen_at, w.created_at,
             ap.username     as actor_username,
             ap.display_name as actor_name
      from public.user_warnings w
      left join public.profiles ap on ap.id = w.created_by
      where w.user_id = auth.uid()
      order by w.created_at desc
      limit greatest(1, least(coalesce(p_limit,100), 500))
    ) t
  ), '[]'::json);
end; $$;

create or replace function public.my_mailbox_unseen_count()
returns int language plpgsql stable security definer set search_path = public
as $$
declare v int;
begin
  if auth.uid() is null then return 0; end if;
  select count(*) into v from public.user_warnings
   where user_id = auth.uid() and seen_at is null;
  return coalesce(v, 0);
end; $$;

create or replace function public.mark_mailbox_seen(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.user_warnings set seen_at = now()
   where id = p_id and user_id = auth.uid() and seen_at is null;
end; $$;

create or replace function public.mark_all_mailbox_seen()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.user_warnings set seen_at = now()
   where user_id = auth.uid() and seen_at is null;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) ADMIN-VISIBLE MODERATOR AUDIT  (immutable; admin-gated per spec)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_moderator_audit(p_limit int default 300)
returns json language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_admin();
  return coalesce((select json_agg(row_to_json(t)) from (
    select a.id, a.action, a.target, a.meta, a.created_at,
           a.user_id as actor_id, u.email as actor_email
    from public.audit_log a
    left join auth.users u on u.id = a.user_id
    where a.action in ('issue_warning','assign_moderator','remove_moderator',
                       'escalate_report','report_status','warn_user')
    order by a.created_at desc
    limit least(coalesce(p_limit,300), 1000)) t), '[]'::json);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) RE-CREATE admin_list_reports  — expose target_type + escalation + resolve
--    the reported user for PROFILE reports (target_type='user', which never set
--    reported_user_id). Everything else is identical to 0017.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_reports(
  p_status text default null,
  p_limit  int  default 200
)
returns json language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_moderator_or_admin();
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        r.id                as report_id,
        r.target_type,
        r.target_id,
        r.message_id,
        r.conversation_id,
        r.reporter_id,
        -- profile reports store the user in target_id, not reported_user_id
        coalesce(r.reported_user_id,
                 case when r.target_type = 'user' then r.target_id end) as reported_user_id,
        r.reason,
        r.details           as description,
        r.status,
        r.escalated,
        r.escalated_at,
        r.escalated_note,
        r.created_at,
        r.reviewed_at,
        r.reviewed_by,
        coalesce(m.content, r.reported_content) as message_content,
        (m.id is not null and coalesce(m.is_deleted,false) = false) as message_exists,
        rp.username     as reporter_username,
        rp.display_name as reporter_name,
        rp.avatar_url   as reporter_avatar,
        tp.username     as reported_username,
        tp.display_name as reported_name,
        tp.avatar_url   as reported_avatar,
        c.type          as conversation_type,
        c.name          as conversation_name
      from public.reports r
      left join public.messages  m  on m.id = r.message_id
      left join public.profiles  rp on rp.id = r.reporter_id
      left join public.profiles  tp on tp.id = coalesce(r.reported_user_id,
                 case when r.target_type = 'user' then r.target_id end)
      left join public.conversations c on c.id = r.conversation_id
      where (p_status is null or r.status = p_status)
      order by r.created_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) t
  ), '[]'::json);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) GRANTS  (all RPCs self-gate; expose to authenticated only)
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.issue_warning(uuid,text,text,uuid)   to authenticated;
grant execute on function public.assign_moderator(uuid)               to authenticated;
grant execute on function public.remove_moderator(uuid)               to authenticated;
grant execute on function public.mod_escalate_report(uuid,text)       to authenticated;
grant execute on function public.my_mailbox(int)                      to authenticated;
grant execute on function public.my_mailbox_unseen_count()            to authenticated;
grant execute on function public.mark_mailbox_seen(uuid)              to authenticated;
grant execute on function public.mark_all_mailbox_seen()              to authenticated;
grant execute on function public.admin_moderator_audit(int)           to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) REALTIME: mailbox badge updates live when a notification arrives
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_warnings'
  ) then
    alter publication supabase_realtime add table public.user_warnings;
  end if;
end $$;
