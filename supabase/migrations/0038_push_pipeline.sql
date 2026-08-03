-- 0038_push_pipeline.sql
-- Server-side push reliability: message + call outbox so notifications don't
-- depend solely on the sender client calling sendPush(). Clients (and a
-- future cron/Edge worker) drain the outbox via dispatch_pending_pushes().
-- Also hardens token registry and muted conversation checks for push.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Outbox of push jobs (message insert / call insert / call status)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_outbox (
  id              bigserial primary key,
  conversation_id uuid not null,
  kind            text not null check (kind in ('message','group','call','missed_call','status','system')),
  title           text not null default '',
  body            text not null default '',
  data            jsonb not null default '{}'::jsonb,
  sender_id       uuid,
  created_at      timestamptz not null default now(),
  attempts        int not null default 0,
  delivered_at    timestamptz,
  last_error      text
);

create index if not exists idx_push_outbox_pending
  on public.push_outbox (created_at)
  where delivered_at is null;

alter table public.push_outbox enable row level security;
-- No client policies: only SECURITY DEFINER helpers + service role write/read.

grant select on public.push_outbox to service_role;
grant all on public.push_outbox to service_role;
grant usage, select on sequence public.push_outbox_id_seq to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Enqueue helper
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enqueue_push(
  p_conversation uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_sender uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rid bigint;
begin
  insert into public.push_outbox (conversation_id, kind, title, body, data, sender_id)
  values (
    p_conversation,
    p_kind,
    coalesce(p_title, ''),
    coalesce(p_body, ''),
    coalesce(p_data, '{}'::jsonb),
    p_sender
  )
  returning id into rid;
  return rid;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Trigger: new message → outbox row (clients also call sendPush; outbox is
--    the authoritative killed-state path once the edge worker drains it).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_name text;
  v_sender_name text;
  v_kind text;
  v_body text;
  v_title text;
begin
  if new.is_deleted or new.type = 'system' then
    return new;
  end if;

  select c.type, c.name into v_type, v_name
  from public.conversations c where c.id = new.conversation_id;

  select coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Someone')
    into v_sender_name
  from public.profiles p where p.id = new.sender_id;

  v_kind := case when v_type = 'group' then 'group' else 'message' end;

  v_body := case new.type
    when 'text'  then left(coalesce(new.content, 'Message'), 200)
    when 'image' then '📷 Photo'
    when 'video' then '🎥 Video'
    when 'audio' then '🎤 Voice message'
    when 'file'  then '📎 Document'
    else 'New message'
  end;

  if v_type = 'group' then
    v_title := coalesce(v_name, 'Group');
    v_body := v_sender_name || ': ' || v_body;
  else
    v_title := v_sender_name;
  end if;

  perform public.enqueue_push(
    new.conversation_id,
    v_kind,
    v_title,
    v_body,
    jsonb_build_object(
      'messageId', new.id::text,
      'senderId', new.sender_id::text,
      'messageType', new.type
    ),
    new.sender_id
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_message_push on public.messages;
create trigger trg_enqueue_message_push
  after insert on public.messages
  for each row execute function public.trg_enqueue_message_push();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Trigger: calls → push (ring / missed)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_enqueue_call_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_name text;
  v_body text;
begin
  if tg_op = 'INSERT' and new.status = 'ringing' then
    select coalesce(nullif(p.display_name, ''), 'Someone') into v_caller_name
    from public.profiles p where p.id = new.caller_id;
    v_body := case when new.type = 'video' then 'Incoming video call' else 'Incoming voice call' end;
    perform public.enqueue_push(
      new.conversation_id,
      'call',
      v_caller_name,
      v_body,
      jsonb_build_object(
        'callId', new.id::text,
        'video', case when new.type = 'video' then 'true' else 'false' end,
        'type', 'call'
      ),
      new.caller_id
    );
  elsif tg_op = 'UPDATE' and new.status = 'missed' and old.status is distinct from 'missed' then
    select coalesce(nullif(p.display_name, ''), 'Someone') into v_caller_name
    from public.profiles p where p.id = new.caller_id;
    perform public.enqueue_push(
      new.conversation_id,
      'missed_call',
      'Missed call',
      'Missed ' || case when new.type = 'video' then 'video' else 'voice' end || ' call from ' || v_caller_name,
      jsonb_build_object(
        'callId', new.id::text,
        'video', case when new.type = 'video' then 'true' else 'false' end,
        'type', 'missed_call'
      ),
      new.caller_id
    );
  elsif tg_op = 'UPDATE'
        and new.status in ('ended', 'declined', 'accepted', 'missed')
        and old.status = 'ringing' then
    -- Cancellation signal for devices still ringing (FCM data cancel).
    perform public.enqueue_push(
      new.conversation_id,
      'system',
      'Call update',
      new.status,
      jsonb_build_object(
        'callId', new.id::text,
        'type', 'call_status',
        'status', new.status
      ),
      new.caller_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_call_push on public.calls;
create trigger trg_enqueue_call_push
  after insert or update of status on public.calls
  for each row execute function public.trg_enqueue_call_push();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Claim pending outbox rows for the Edge Function (service role / cron)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_push_outbox(p_limit int default 50)
returns setof public.push_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id
    from public.push_outbox
    where delivered_at is null
      and attempts < 8
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update public.push_outbox o
  set attempts = o.attempts + 1
  from claimed
  where o.id = claimed.id
  returning o.*;
end;
$$;

create or replace function public.mark_push_delivered(p_id bigint, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_error is null then
    update public.push_outbox
    set delivered_at = now(), last_error = null
    where id = p_id;
  else
    update public.push_outbox
    set last_error = left(p_error, 500)
    where id = p_id;
  end if;
end;
$$;

grant execute on function public.enqueue_push(uuid, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.claim_push_outbox(int) to service_role;
grant execute on function public.mark_push_delivered(bigint, text) to service_role;

-- Clients can also mark a row delivered after a successful sendPush (optional).
grant execute on function public.mark_push_delivered(bigint, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Muted conversations helper for Edge Function (service role)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_conversation_muted(p_user uuid, p_conversation uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.muted_conversations m
    where m.user_id = p_user
      and m.conversation_id = p_conversation
      and (m.muted_until is null or m.muted_until > now())
  );
$$;

grant execute on function public.is_conversation_muted(uuid, uuid) to authenticated;
grant execute on function public.is_conversation_muted(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Cleanup old delivered outbox rows (keep 7 days)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.purge_old_push_outbox()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.push_outbox
  where delivered_at is not null
    and delivered_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.purge_old_push_outbox() to service_role;
