-- FUTUREHAT — atomic group-conversation creation
--
-- Fixes group creation, which broke after migration 0015 tightened the
-- "add participants" RLS check. The new check contains a subquery on
-- public.conversations, but that table's "read member conversations" policy
-- requires the reader to already be a member — the creator isn't yet, so the
-- subquery returns zero rows and the bulk-insert of participants fails.
--
-- Mirrors start_direct_conversation() (0001): a SECURITY DEFINER RPC that
-- creates the conversation and adds ALL participants atomically in one txn,
-- bypassing RLS during the writes it makes on the caller's behalf.
create or replace function public.create_group_conversation(
  p_name       text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  me   uuid := auth.uid();
  pid  uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'group name is required';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', trim(p_name), me)
  returning id into conv;

  -- Creator is admin (0001 role check allows 'member' | 'admin').
  insert into public.conversation_participants (conversation_id, user_id, role)
  values (conv, me, 'admin');

  -- Everyone else joins as member. ON CONFLICT tolerates a duplicate/self in
  -- the provided array so the RPC is idempotent per (conv, user) pair.
  if p_member_ids is not null then
    foreach pid in array p_member_ids loop
      if pid <> me then
        insert into public.conversation_participants (conversation_id, user_id, role)
        values (conv, pid, 'member')
        on conflict (conversation_id, user_id) do nothing;
      end if;
    end loop;
  end if;

  return conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
