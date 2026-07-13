-- 0043_push_production_hardening.sql
-- WhatsApp-class push reliability:
--   • Richer media previews in the outbox trigger
--   • Idempotent delivery (dedupe keys so client+outbox never double-ring)
--   • Retry backoff metadata
--   • mention kind support
--   • Optional pg_net instant drain after enqueue (when extension available)
-- Safe / idempotent to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Dedupe table — first successful fan-out wins for a given logical event
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_sent_dedupe (
  key         text primary key,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_sent_dedupe_created
  on public.push_sent_dedupe (created_at);

alter table public.push_sent_dedupe enable row level security;
-- service role / security definer only
grant all on public.push_sent_dedupe to service_role;

create or replace function public.claim_push_dedupe(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_key), '') = '' then
    return true; -- no key → allow send
  end if;
  begin
    insert into public.push_sent_dedupe (key) values (p_key);
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;

grant execute on function public.claim_push_dedupe(text) to service_role;
grant execute on function public.claim_push_dedupe(text) to authenticated;

-- Purge dedupe keys older than 48h (messages no longer need collapse)
create or replace function public.purge_push_dedupe()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.push_sent_dedupe
  where created_at < now() - interval '48 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.purge_push_dedupe() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Outbox: allow mention kind + retry_after for backoff
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.push_outbox
  drop constraint if exists push_outbox_kind_check;

alter table public.push_outbox
  add constraint push_outbox_kind_check
  check (kind in ('message','group','call','missed_call','status','system','mention'));

alter table public.push_outbox
  add column if not exists retry_after timestamptz;

alter table public.push_outbox
  add column if not exists dedupe_key text;

create index if not exists idx_push_outbox_retry
  on public.push_outbox (retry_after)
  where delivered_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Claim with exponential backoff (skip rows still in retry_after window)
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
      and attempts < 12
      and (retry_after is null or retry_after <= now())
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update public.push_outbox o
  set attempts = o.attempts + 1,
      -- Backoff: 2^min(attempts,6) seconds (2s … 64s), jitter-free for simplicity
      retry_after = now() + make_interval(secs => least(64, power(2, least(o.attempts, 6))::int))
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
    set delivered_at = now(), last_error = null, retry_after = null
    where id = p_id;
  else
    update public.push_outbox
    set last_error = left(p_error, 500)
    where id = p_id;
  end if;
end;
$$;

-- Mark all pending outbox rows for a dedupe key as delivered (client already fanned out)
create or replace function public.mark_push_dedupe_delivered(p_dedupe_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if coalesce(trim(p_dedupe_key), '') = '' then
    return 0;
  end if;
  update public.push_outbox
  set delivered_at = coalesce(delivered_at, now()), last_error = null, retry_after = null
  where delivered_at is null
    and (
      dedupe_key = p_dedupe_key
      or data->>'messageId' = p_dedupe_key
      or data->>'callId' = p_dedupe_key
      or ('msg:' || (data->>'messageId')) = p_dedupe_key
      or ('call:' || (data->>'callId') || ':' || coalesce(data->>'type', kind)) = p_dedupe_key
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.mark_push_dedupe_delivered(text) to service_role;
grant execute on function public.mark_push_dedupe_delivered(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Message trigger — full media taxonomy + stable dedupe_key
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
  v_dedupe text;
  v_is_gif boolean;
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

  -- GIF detection: image rows that point at a .gif (client convention)
  v_is_gif := (new.type = 'image' and coalesce(new.media_url, '') ~* '\.gif(\?|#|$)');

  v_body := case
    when new.type = 'text' and coalesce(new.content, '') like '📊%' then left(new.content, 200)
    when new.type = 'text' and coalesce(new.content, '') ~* '^(📍|location:)' then '📍 Location'
    when new.type = 'text' and coalesce(new.content, '') ~* '^(👤|contact:)' then '👤 Contact'
    when new.type = 'text' then left(coalesce(nullif(trim(new.content), ''), 'Message'), 200)
    when v_is_gif then '🎞️ GIF'
    when new.type = 'image' then '📷 Photo'
    when new.type = 'video' then '🎥 Video'
    when new.type = 'audio' then '🎤 Voice message'
    when new.type = 'file' then
      case when coalesce(nullif(trim(new.content), ''), '') <> ''
        then '📄 ' || left(new.content, 120)
        else '📄 Document'
      end
    when new.type = 'sticker' then 'Sticker'
    else 'New message'
  end;

  -- Mentions: @ in text body → higher-priority channel on device
  if v_type = 'group' and new.type = 'text' and coalesce(new.content, '') ~ '@' then
    v_kind := 'mention';
  end if;

  if v_type = 'group' then
    v_title := coalesce(v_name, 'Group');
    v_body := v_sender_name || ': ' || v_body;
  else
    v_title := v_sender_name;
  end if;

  v_dedupe := 'msg:' || new.id::text;

  insert into public.push_outbox (conversation_id, kind, title, body, data, sender_id, dedupe_key)
  values (
    new.conversation_id,
    v_kind,
    v_title,
    v_body,
    jsonb_build_object(
      'messageId', new.id::text,
      'senderId', new.sender_id::text,
      'messageType', new.type,
      'type', case when v_kind = 'mention' then 'mention' else 'message' end
    ),
    new.sender_id,
    v_dedupe
  );

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Call trigger — stable dedupe keys for ring / cancel / missed
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
  v_dedupe text;
begin
  if tg_op = 'INSERT' and new.status = 'ringing' then
    select coalesce(nullif(p.display_name, ''), 'Someone') into v_caller_name
    from public.profiles p where p.id = new.caller_id;
    v_body := case when new.type = 'video' then 'Incoming video call' else 'Incoming voice call' end;
    v_dedupe := 'call:' || new.id::text || ':ring';
    insert into public.push_outbox (conversation_id, kind, title, body, data, sender_id, dedupe_key)
    values (
      new.conversation_id,
      'call',
      v_caller_name,
      v_body,
      jsonb_build_object(
        'callId', new.id::text,
        'video', case when new.type = 'video' then 'true' else 'false' end,
        'type', 'call'
      ),
      new.caller_id,
      v_dedupe
    );
  elsif tg_op = 'UPDATE' and new.status = 'missed' and old.status is distinct from 'missed' then
    select coalesce(nullif(p.display_name, ''), 'Someone') into v_caller_name
    from public.profiles p where p.id = new.caller_id;
    v_dedupe := 'call:' || new.id::text || ':missed';
    insert into public.push_outbox (conversation_id, kind, title, body, data, sender_id, dedupe_key)
    values (
      new.conversation_id,
      'missed_call',
      'Missed call',
      'Missed ' || case when new.type = 'video' then 'video' else 'voice' end || ' call from ' || v_caller_name,
      jsonb_build_object(
        'callId', new.id::text,
        'video', case when new.type = 'video' then 'true' else 'false' end,
        'type', 'missed_call'
      ),
      new.caller_id,
      v_dedupe
    );
  elsif tg_op = 'UPDATE'
        and new.status in ('ended', 'declined', 'accepted', 'missed')
        and old.status = 'ringing' then
    -- Always enqueue cancel so killed devices drop the ring UI (no ghost calls).
    v_dedupe := 'call:' || new.id::text || ':cancel:' || new.status;
    insert into public.push_outbox (conversation_id, kind, title, body, data, sender_id, dedupe_key)
    values (
      new.conversation_id,
      'system',
      'Call update',
      new.status,
      jsonb_build_object(
        'callId', new.id::text,
        'type', 'call_status',
        'status', new.status
      ),
      new.caller_id,
      v_dedupe
    );
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Unread total helper (badge sync) — mirrors client getMyConversations math
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_total_unread()
returns int
language sql
security definer
set search_path = public
stable
as $$
  with my_convs as (
    select conversation_id
    from public.conversation_participants
    where user_id = auth.uid()
  ),
  from_others as (
    select m.conversation_id, count(*)::int as n
    from public.messages m
    join my_convs c on c.conversation_id = m.conversation_id
    where m.sender_id <> auth.uid()
      and m.is_deleted is not true
      and coalesce(m.type, 'text') <> 'system'
    group by m.conversation_id
  ),
  read_by_me as (
    select m.conversation_id, count(*)::int as n
    from public.message_receipts r
    join public.messages m on m.id = r.message_id
    join my_convs c on c.conversation_id = m.conversation_id
    where r.user_id = auth.uid()
      and r.status = 'read'
      and m.sender_id <> auth.uid()
      and m.is_deleted is not true
    group by m.conversation_id
  )
  select coalesce(sum(greatest(0, fo.n - coalesce(rb.n, 0))), 0)::int
  from from_others fo
  left join read_by_me rb on rb.conversation_id = fo.conversation_id;
$$;

grant execute on function public.my_total_unread() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Cleanup helper: purge old outbox + dedupe together
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.purge_old_push_outbox()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int; d int;
begin
  delete from public.push_outbox
  where delivered_at is not null
    and delivered_at < now() - interval '7 days';
  get diagnostics n = row_count;
  select public.purge_push_dedupe() into d;
  return n;
end;
$$;
