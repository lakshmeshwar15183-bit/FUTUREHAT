-- Lumixo — Telegram-style "delete for everyone": hard DELETE (no tombstone).
-- "Delete for me" remains per-user via hidden_messages (0011).
-- reply_to is ON DELETE SET NULL so replies stay valid without crash.

-- Realtime DELETE filters need full row identity (conversation_id on old).
alter table public.messages replica identity full;

-- Direct DELETE for own non-system messages (members only).
drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages
  for delete to authenticated
  using (
    sender_id = auth.uid()
    and coalesce(type, 'text') is distinct from 'system'
    and public.is_member(conversation_id)
  );

-- Authoritative RPC: clearer errors, same hard-delete semantics.
create or replace function public.delete_message_for_everyone(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid;
  v_type   text;
  v_conv   uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select sender_id, type, conversation_id
    into v_sender, v_type, v_conv
  from public.messages
  where id = p_message;

  if not found then
    return; -- already gone (idempotent)
  end if;

  if v_sender is distinct from auth.uid() then
    raise exception 'only the sender can delete for everyone';
  end if;

  if coalesce(v_type, 'text') = 'system' then
    raise exception 'system messages cannot be deleted';
  end if;

  if not public.is_member(v_conv) then
    raise exception 'not a conversation member';
  end if;

  delete from public.messages where id = p_message;
end;
$$;

revoke all on function public.delete_message_for_everyone(uuid) from public;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

comment on function public.delete_message_for_everyone(uuid) is
  'Hard-delete own message for all participants (Telegram-style). No tombstone.';
