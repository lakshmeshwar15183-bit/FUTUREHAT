-- 0014_starred_messages_view.sql — "Starred messages" browser.
-- ============================================================================
-- Purely ADDITIVE. The star/unstar data layer already exists (0011:
-- starred_messages). This adds ONE read-only function that returns the caller's
-- starred messages joined with their content, sender, and conversation title so
-- the app can show a WhatsApp-style "Starred messages" list across all chats.
-- No existing table, policy, or function is modified. Idempotent.
--
-- Security: SECURITY DEFINER so it can resolve sender/conversation display data,
-- but it is hard-scoped to auth.uid()'s OWN stars AND re-checks that the caller
-- is still a participant of each message's conversation (so a message from a chat
-- they have since left is not returned). Safe to expose to `authenticated`.
-- ============================================================================

create or replace function public.get_starred_messages()
returns table (
  message_id         uuid,
  conversation_id    uuid,
  sender_id          uuid,
  type               text,
  content            text,
  media_url          text,
  created_at         timestamptz,
  starred_at         timestamptz,
  sender_name        text,
  sender_avatar      text,
  conversation_type  text,
  conversation_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id            as message_id,
    m.conversation_id,
    m.sender_id,
    m.type,
    m.content,
    m.media_url,
    m.created_at,
    s.created_at    as starred_at,
    sp.display_name as sender_name,
    sp.avatar_url   as sender_avatar,
    c.type          as conversation_type,
    coalesce(
      c.name,  -- group name
      (        -- else the other participant's name (direct chat)
        select op.display_name
        from public.conversation_participants cp2
        join public.profiles op on op.id = cp2.user_id
        where cp2.conversation_id = c.id
          and cp2.user_id <> auth.uid()
        limit 1
      )
    ) as conversation_title
  from public.starred_messages s
  join public.messages m       on m.id = s.message_id
  join public.conversations c  on c.id = m.conversation_id
  left join public.profiles sp on sp.id = m.sender_id
  where s.user_id = auth.uid()
    and not m.is_deleted
    -- caller must still be a participant of the conversation
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = m.conversation_id
        and cp.user_id = auth.uid()
    )
  order by s.created_at desc;
$$;

grant execute on function public.get_starred_messages() to authenticated;
