-- 0017_message_reports.sql — Report-a-message + Admin Reports dashboard.
-- ============================================================================
-- ADDITIVE ONLY. Extends the existing public.reports table (0008) with the
-- explicit columns the admin dashboard needs, gives admins read/update access
-- (previously only the reporter could read their own rows — so admins could not
-- see ANY report), adds admin RPCs for the Reports section, a lightweight
-- user_warnings table for the "Warn user" action, and puts reports on realtime
-- so the dashboard badge updates live. Idempotent; safe to re-run. Apply after
-- 0016. No existing column is dropped or altered; submitReport() keeps working.
-- ============================================================================

-- ── 1) Extend reports with explicit, queryable columns ──────────────────────
-- All nullable so existing rows (and the old target_type/target_id shape) stay
-- valid. message_id/conversation_id/reported_user use ON DELETE SET NULL so a
-- report is never orphan-deleted when its message/chat/user is removed — the
-- evidence survives. reported_content snapshots the message text at report time
-- because admin_delete_message() nulls messages.content.
alter table public.reports add column if not exists message_id       uuid references public.messages(id)      on delete set null;
alter table public.reports add column if not exists conversation_id  uuid references public.conversations(id) on delete set null;
alter table public.reports add column if not exists reported_user_id uuid references auth.users(id)           on delete set null;
alter table public.reports add column if not exists reported_content text;
alter table public.reports add column if not exists reviewed_at      timestamptz;
alter table public.reports add column if not exists reviewed_by      uuid references auth.users(id) on delete set null;

create index if not exists idx_reports_status       on public.reports(status, created_at desc);
create index if not exists idx_reports_reported_user on public.reports(reported_user_id);
create index if not exists idx_reports_message      on public.reports(message_id);

-- Status vocabulary is unchanged from 0008: open|reviewing|resolved|dismissed.
-- The dashboard labels these Pending|Reviewed|Resolved|Dismissed. We keep the
-- existing CHECK constraint so no existing row is invalidated.

-- ── 2) Admin visibility (the actual reason reports never reached the dashboard)
drop policy if exists "admin read all reports"   on public.reports;
create policy "admin read all reports" on public.reports
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists "admin update reports" on public.reports;
create policy "admin update reports" on public.reports
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- (The reporter's own insert/select policies from 0008 remain in force.)

-- ── 3) user_warnings — backs the admin "Warn user" action ───────────────────
create table if not exists public.user_warnings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  message    text not null,
  report_id  uuid references public.reports(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists idx_user_warnings_user on public.user_warnings(user_id, created_at desc);
alter table public.user_warnings enable row level security;

drop policy if exists "read own warnings" on public.user_warnings;
create policy "read own warnings" on public.user_warnings
  for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));
drop policy if exists "user acks own warning" on public.user_warnings;
create policy "user acks own warning" on public.user_warnings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 4) Reporter-facing RPC: file a message report with a content snapshot ────
-- SECURITY DEFINER so it can read the message to snapshot content + derive the
-- sender/conversation even though the reporter can't UPDATE messages. Verifies
-- the reporter is a participant of the message's conversation (can't report a
-- message you can't see). Reason is validated against the fixed picker list.
create or replace function public.report_message(
  p_message uuid,
  p_reason  text,
  p_details text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_conv   uuid;
  v_sender uuid;
  v_body   text;
  v_id     uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_reason not in ('spam','harassment','abuse','fake_information',
                      'illegal_content','violence','child_safety','other') then
    raise exception 'invalid reason %', p_reason;
  end if;

  select m.conversation_id, m.sender_id, m.content
    into v_conv, v_sender, v_body
    from public.messages m where m.id = p_message;
  if v_conv is null then raise exception 'message not found'; end if;

  -- The reporter must be a participant of the conversation the message is in.
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = auth.uid()
  ) then raise exception 'not authorized to report this message'; end if;

  insert into public.reports (
    reporter_id, target_type, target_id, message_id, conversation_id,
    reported_user_id, reported_content, reason, details, status
  ) values (
    auth.uid(), 'message', p_message, p_message, v_conv,
    v_sender, v_body, p_reason, p_details, 'open'
  ) returning id into v_id;

  return v_id;
end; $$;

-- ── 5) Admin RPCs for the Reports dashboard ─────────────────────────────────
-- List reports (optionally filtered by status) with reporter + reported-user
-- profiles and the current message content joined in. Newest first.
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
        r.message_id,
        r.conversation_id,
        r.reporter_id,
        r.reported_user_id,
        r.reason,
        r.details           as description,
        r.status,
        r.created_at,
        r.reviewed_at,
        r.reviewed_by,
        -- live message content if still present, else the snapshot taken at
        -- report time (survives admin_delete_message / user delete).
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
      left join public.profiles  tp on tp.id = r.reported_user_id
      left join public.conversations c on c.id = r.conversation_id
      where (p_status is null or r.status = p_status)
      order by r.created_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) t
  ), '[]'::json);
end; $$;

-- Count of still-actionable reports — powers the dashboard badge.
create or replace function public.admin_reports_pending_count()
returns int language plpgsql stable security definer set search_path = public
as $$
declare v int;
begin
  perform public._require_moderator_or_admin();
  select count(*) into v from public.reports where status in ('open','reviewing');
  return coalesce(v, 0);
end; $$;

-- Move a report through its lifecycle. Stamps reviewer + time. Covers the
-- Review / Dismiss / Resolve buttons.
create or replace function public.admin_set_report_status(
  p_report uuid,
  p_status text
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public._require_moderator_or_admin();
  if p_status not in ('open','reviewing','resolved','dismissed') then
    raise exception 'invalid status %', p_status;
  end if;
  update public.reports
     set status      = p_status,
         reviewed_at = case when p_status in ('open') then null else now() end,
         reviewed_by = case when p_status in ('open') then null else auth.uid() end
   where id = p_report;
  if not found then raise exception 'report not found'; end if;
  perform public._audit('report_status', p_report::text,
                        jsonb_build_object('status', p_status));
end; $$;

-- Warn a user (persisted; the client can surface unseen warnings). Optionally
-- linked to the report that triggered it.
create or replace function public.admin_warn_user(
  p_target  uuid,
  p_message text,
  p_report  uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_moderator_or_admin();
  perform public._guard_owner_target(p_target);
  if coalesce(trim(p_message),'') = '' then raise exception 'warning message required'; end if;
  insert into public.user_warnings (user_id, message, report_id, created_by)
  values (p_target, p_message, p_report, auth.uid())
  returning id into v_id;
  perform public._audit('warn_user', p_target::text,
                        jsonb_build_object('report', p_report, 'message', p_message));
  return v_id;
end; $$;

-- Fetch a conversation's messages around/for the admin viewer so the dashboard
-- can open the exact chat and scroll to the reported message. Read-only.
create or replace function public.admin_get_conversation(
  p_conversation uuid,
  p_limit int default 300
)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v json;
begin
  perform public._require_moderator_or_admin();
  select json_build_object(
    'conversation', (
      select json_build_object('id', c.id, 'type', c.type, 'name', c.name,
                               'created_at', c.created_at)
      from public.conversations c where c.id = p_conversation
    ),
    'participants', coalesce((
      select json_agg(json_build_object('id', p.id, 'username', p.username,
             'display_name', p.display_name, 'avatar_url', p.avatar_url))
      from public.conversation_participants cp
      join public.profiles p on p.id = cp.user_id
      where cp.conversation_id = p_conversation
    ), '[]'::json),
    'messages', coalesce((
      select json_agg(row_to_json(mm) order by mm.created_at)
      from (
        select m.id, m.sender_id, m.type, m.content, m.media_url,
               m.is_deleted, m.created_at, m.edited_at
        from public.messages m
        where m.conversation_id = p_conversation
        order by m.created_at desc
        limit greatest(1, least(coalesce(p_limit,300), 1000))
      ) mm
    ), '[]'::json)
  ) into v;
  if v is null then raise exception 'conversation not found'; end if;
  return v;
end; $$;

-- ── 6) Grants ───────────────────────────────────────────────────────────────
grant execute on function public.report_message(uuid,text,text)            to authenticated;
grant execute on function public.admin_list_reports(text,int)              to authenticated;
grant execute on function public.admin_reports_pending_count()             to authenticated;
grant execute on function public.admin_set_report_status(uuid,text)        to authenticated;
grant execute on function public.admin_warn_user(uuid,text,uuid)           to authenticated;
grant execute on function public.admin_get_conversation(uuid,int)          to authenticated;
grant select, update on public.user_warnings to authenticated;

-- ── 7) Realtime: dashboard badge + list update live on new reports ──────────
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table public.reports;
  end if;
end $$;
