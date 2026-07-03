-- 0019_deleted_conversations_upsert_fix.sql
-- Fixes: "new row violates row-level security policy (USING expression)" when a
-- user taps "Delete for me" on a chat they've deleted before.
-- ============================================================================
-- Root cause: the client used a PostgREST upsert, which compiles to
--   INSERT ... ON CONFLICT DO UPDATE.
-- The DO UPDATE branch is authorised against the table's UPDATE policy's USING
-- expression. 0016 created SELECT / INSERT / DELETE policies but NO UPDATE
-- policy, so the USING expression defaulted to FALSE and every re-delete was
-- rejected — even though the row already belonged to the user.
--
-- The client is now fixed to use ON CONFLICT DO NOTHING (a re-delete is a no-op,
-- which is the correct semantics), so the UPDATE path is no longer taken. This
-- migration adds the matching UPDATE policy anyway as defence-in-depth, so the
-- table is safe under ANY upsert style and stays consistent with its siblings.
-- Users may still only ever touch their OWN rows. Idempotent. Apply after 0016.

alter table public.deleted_conversations enable row level security;

-- Own-rows-only UPDATE policy (mirrors the SELECT/INSERT/DELETE own-row checks).
drop policy if exists "update own deleted" on public.deleted_conversations;
create policy "update own deleted" on public.deleted_conversations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant update on public.deleted_conversations to authenticated;

-- Realtime: publish deleted_conversations so a "Delete for me" on one device
-- removes the chat from this user's OTHER devices instantly (no manual refresh).
-- conversation_participants is already published (0001), which covers the
-- delete-for-everyone cascade. Guarded so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deleted_conversations'
  ) then
    alter publication supabase_realtime add table public.deleted_conversations;
  end if;
end $$;
