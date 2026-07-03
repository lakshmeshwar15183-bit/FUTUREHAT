-- 0018_delete_conversation_for_everyone.sql — Telegram-style "Delete for
-- everyone" at the conversation level, for regular users (not just admins).
-- ============================================================================
-- ADDITIVE ONLY: one new SECURITY DEFINER function. No table/column changes.
-- "Delete for me" already exists (0016, deleted_conversations). This adds the
-- destructive counterpart: remove the whole conversation for ALL participants.
-- Permission is re-checked server-side — allowed for either member of a DIRECT
-- chat, or the CREATOR of a group. Deleting the conversation row cascades to
-- messages, participants, receipts, reactions, etc. (all FKs are ON DELETE
-- CASCADE from 0001), so no orphan rows survive. Idempotent. Apply after 0017.
-- ============================================================================

create or replace function public.delete_conversation_for_everyone(
  p_conversation uuid
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_type       text;
  v_created_by uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select type, created_by into v_type, v_created_by
    from public.conversations where id = p_conversation;
  if v_type is null then raise exception 'conversation not found'; end if;

  -- Caller must be a participant.
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation and cp.user_id = auth.uid()
  ) then
    raise exception 'not authorized: not a participant';
  end if;

  -- Direct chat: either member may delete for both. Group: only the creator.
  if v_type = 'group' and v_created_by is distinct from auth.uid() then
    raise exception 'not authorized: only the group creator can delete for everyone';
  end if;

  -- Cascades remove messages / participants / receipts / reactions / etc.
  delete from public.conversations where id = p_conversation;

  perform public._audit('delete_conversation_for_everyone', p_conversation::text,
                        jsonb_build_object('type', v_type));
end; $$;

grant execute on function public.delete_conversation_for_everyone(uuid) to authenticated;
