-- 0046_call_chat_system_messages.sql
-- WhatsApp-class: each call leaves ONE system message in the conversation
-- (missed / declined / cancelled / duration). Idempotent via call id in content key.

create or replace function public._fmt_call_duration(p_start timestamptz, p_end timestamptz)
returns text
language plpgsql
immutable
as $$
declare
  secs int;
begin
  if p_start is null or p_end is null then
    return null;
  end if;
  secs := greatest(1, floor(extract(epoch from (p_end - p_start)))::int);
  return (secs / 60)::text || ':' || lpad((secs % 60)::text, 2, '0');
end;
$$;

create or replace function public.trg_call_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_text text;
  v_dur  text;
  v_exists boolean;
begin
  -- Only terminal (or accepted→ended) transitions create chat entries.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('ended', 'missed', 'declined') then
    return new;
  end if;

  -- Exactly one system message per call id.
  select exists (
    select 1 from public.messages m
    where m.conversation_id = new.conversation_id
      and m.type = 'system'
      and m.content like '%[call:' || new.id::text || ']%'
  ) into v_exists;
  if v_exists then
    return new;
  end if;

  v_kind := case when new.type = 'video' then 'Video' else 'Voice' end;
  v_dur := public._fmt_call_duration(new.answered_at, new.ended_at);

  if new.status = 'missed' then
    v_text := 'Missed ' || lower(v_kind) || ' call';
  elsif new.status = 'declined' then
    v_text := 'Declined ' || lower(v_kind) || ' call';
  elsif new.answered_at is null then
    v_text := 'Cancelled ' || lower(v_kind) || ' call';
  elsif v_dur is not null then
    v_text := v_kind || ' call · ' || v_dur;
  else
    v_text := v_kind || ' call';
  end if;

  -- Opaque tag for idempotency + client deep-link (not shown if we strip it in UI).
  v_text := v_text || ' [call:' || new.id::text || ']';

  -- Allow past guard_message_insert system-type block.
  perform set_config('app.allow_system_msg', 'on', true);

  insert into public.messages (conversation_id, sender_id, type, content)
  values (new.conversation_id, new.caller_id, 'system', v_text);

  return new;
end;
$$;

drop trigger if exists trg_call_chat_message on public.calls;
create trigger trg_call_chat_message
  after insert or update of status on public.calls
  for each row execute function public.trg_call_chat_message();
