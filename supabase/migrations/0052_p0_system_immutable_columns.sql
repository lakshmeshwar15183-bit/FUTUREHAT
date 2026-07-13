-- 0052: freeze remaining system-message columns (expires_at, is_forwarded, created_at).
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.type is distinct from new.type then
    raise exception 'message type cannot be changed';
  end if;
  if old.sender_id is distinct from new.sender_id then
    raise exception 'sender cannot be changed';
  end if;
  if old.conversation_id is distinct from new.conversation_id then
    raise exception 'conversation cannot be changed';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'created_at cannot be changed';
  end if;

  if old.type = 'system'
     and current_setting('app.allow_system_msg', true) is distinct from 'on' then
    if old.content is distinct from new.content
       or old.media_url is distinct from new.media_url
       or old.is_deleted is distinct from new.is_deleted
       or old.reply_to is distinct from new.reply_to
       or old.edited_at is distinct from new.edited_at
       or old.media_meta is distinct from new.media_meta
       or old.expires_at is distinct from new.expires_at
       or old.is_forwarded is distinct from new.is_forwarded
    then
      raise exception 'system messages are immutable';
    end if;
  end if;

  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  return new;
end;
$$;

-- Defense-in-depth RLS: clients cannot INSERT type=system (trigger is primary).
-- Preserve 0037 only_admins_can_send group rules.
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and type is distinct from 'system'
    and public.is_member(conversation_id)
    and (
      not exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.type = 'group'
          and c.only_admins_can_send = true
      )
      or public.is_group_admin(conversation_id)
    )
  );
