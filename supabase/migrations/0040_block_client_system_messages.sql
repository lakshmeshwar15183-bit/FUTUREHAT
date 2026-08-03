-- 0040 — Clients must not forge type='system' messages (privilege / spam).
-- post_system_message() sets a transaction-local flag that this trigger accepts.

create or replace function public.post_system_message(p_conv uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  me  uuid := auth.uid();
  sender uuid;
begin
  if p_text is null or length(trim(p_text)) = 0 then
    return null;
  end if;
  sender := coalesce(me, (select created_by from public.conversations where id = p_conv));
  if sender is null then
    return null;
  end if;
  -- Allow this INSERT past guard_message_insert's system-type block.
  perform set_config('app.allow_system_msg', 'on', true);
  insert into public.messages (conversation_id, sender_id, type, content)
  values (p_conv, sender, 'system', trim(p_text))
  returning id into mid;
  return mid;
end;
$$;

create or replace function public.guard_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  if new.type = 'system' then
    if current_setting('app.allow_system_msg', true) is distinct from 'on' then
      raise exception 'system messages cannot be inserted by clients';
    end if;
    return new; -- no rate limit for system notices
  end if;

  if auth.uid() is not null then
    if not public.check_rate_limit('send_message', 120) then
      raise exception 'rate limit exceeded';
    end if;
  end if;

  -- Sender must be the authenticated user (defense in depth vs RLS).
  if auth.uid() is not null and new.sender_id is distinct from auth.uid() then
    raise exception 'sender mismatch';
  end if;

  return new;
end;
$$;
