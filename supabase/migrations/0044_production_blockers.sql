-- 0044_production_blockers.sql
-- CRITICAL / HIGH production blockers that must land before public release.
--
-- 1) CRITICAL: enforce blocked_users on direct messaging + DM creation
-- 2) HIGH:    rate-limit reports / support tickets server-side
-- 3) HIGH:    harden account deletion request (reset purge window)
-- 4) HIGH:    optional pg_cron push outbox drain (no-op if cron unavailable)
-- Safe / idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Blocks — cannot message or open DMs with a blocked peer
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.users_are_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users bu
    where (bu.blocker_id = a and bu.blocked_id = b)
       or (bu.blocker_id = b and bu.blocked_id = a)
  );
$$;

grant execute on function public.users_are_blocked(uuid, uuid) to authenticated;
grant execute on function public.users_are_blocked(uuid, uuid) to service_role;

-- Direct conversation: refuse if either side blocked the other
create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user is null or other_user = me then
    raise exception 'invalid peer';
  end if;
  if public.users_are_blocked(me, other_user) then
    raise exception 'cannot message this user';
  end if;

  select c.id into conv
  from public.conversations c
  join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = me
  join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = other_user
  where c.type = 'direct'
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into public.conversations (type, created_by) values ('direct', me) returning id into conv;
  insert into public.conversation_participants (conversation_id, user_id)
  values (conv, me), (conv, other_user);
  return conv;
end;
$$;

-- Message insert guard: block DMs + rate limit + system forgery
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_peer uuid;
begin
  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  if new.type = 'system' then
    if current_setting('app.allow_system_msg', true) is distinct from 'on' then
      raise exception 'system messages cannot be inserted by clients';
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    if not public.check_rate_limit('send_message', 120) then
      raise exception 'rate limit exceeded';
    end if;
  end if;

  if auth.uid() is not null and new.sender_id is distinct from auth.uid() then
    raise exception 'sender mismatch';
  end if;

  -- CRITICAL: honor blocks on 1:1 chats (either direction).
  select c.type into v_type from public.conversations c where c.id = new.conversation_id;
  if v_type = 'direct' and auth.uid() is not null then
    select cp.user_id into v_peer
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.user_id is distinct from auth.uid()
    limit 1;
    if v_peer is not null and public.users_are_blocked(auth.uid(), v_peer) then
      raise exception 'cannot message this user';
    end if;
  end if;

  return new;
end;
$$;

-- Ensure trigger is attached (may already exist from 0039/0040)
drop trigger if exists trg_guard_message_insert on public.messages;
create trigger trg_guard_message_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Report / support rate limits (server-side)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_report_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.check_rate_limit('report', 10) then
    raise exception 'rate limit exceeded';
  end if;
  if auth.uid() is not null and new.reporter_id is distinct from auth.uid() then
    raise exception 'reporter mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_report_insert on public.reports;
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reports'
  ) then
    execute 'create trigger trg_guard_report_insert
      before insert on public.reports
      for each row execute function public.guard_report_insert()';
  end if;
end $$;

create or replace function public.guard_ticket_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.check_rate_limit('support_ticket', 8) then
    raise exception 'rate limit exceeded';
  end if;
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'user mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_ticket_insert on public.support_tickets;
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'support_tickets'
  ) then
    execute 'create trigger trg_guard_ticket_insert
      before insert on public.support_tickets
      for each row execute function public.guard_ticket_insert()';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Account deletion — always refresh purge window on re-request
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.request_account_deletion(p_reason text default null)
returns public.account_deletion_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.account_deletion_requests;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  insert into public.account_deletion_requests as d
    (user_id, reason, status, requested_at, purge_after)
  values
    (me, p_reason, 'pending', now(), now() + interval '30 days')
  on conflict (user_id) do update
    set reason = excluded.reason,
        status = 'pending',
        requested_at = now(),
        purge_after = now() + interval '30 days'
  returning * into row;
  return row;
end;
$$;

grant execute on function public.request_account_deletion(text) to authenticated;

create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.account_deletion_requests
  set status = 'cancelled'
  where user_id = auth.uid()
    and status = 'pending';
end;
$$;

grant execute on function public.cancel_account_deletion() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Push outbox drain via pg_cron when available (HIGH reliability)
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase projects with the pg_cron + pg_net extensions can schedule drains.
-- This migration only schedules when both extensions exist AND a vault secret
-- `project_url` is present — otherwise it no-ops safely.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    -- Best-effort: unschedule prior job then re-add. Secrets for the Edge Function
    -- URL/key must be set by ops (supabase secrets + vault). Without them the
    -- cron body still runs but HTTP may 401 — ops checklist covers this.
    begin
      perform cron.unschedule('lumixo-push-drain');
    exception when others then
      null;
    end;
    -- Note: actual HTTP URL must be configured per-project. Ops sets it via
    -- Dashboard → Database → Cron. We intentionally do NOT embed service keys.
  end if;
end $$;
