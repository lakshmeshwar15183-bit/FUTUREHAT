-- 0020_remove_announcement.sql — Remove the active announcement.
-- ============================================================================
-- WHAT THIS DOES
--   Adds a single owner-gated RPC, admin_remove_announcement(), that deletes the
--   latest active announcement row from public.announcements and audits it. This
--   powers the "Remove Current Announcement" button in the Admin Dashboard.
--
-- WHAT IT DOES NOT DO
--   • Does NOT modify admin_send_announcement — publishing is untouched.
--   • Does NOT change the announcements table structure (no new columns). The
--     existing `active` flag / RLS policy remain the source of truth for clients.
--   • Does NOT touch any other feature.
--
-- REALTIME
--   Adds public.announcements to the supabase_realtime publication (idempotent)
--   so client AdminGate components receive postgres_changes events and can drop
--   the banner the instant the row is deleted — no restart/refresh needed.
--   Mirrors the pattern used in 0017_message_reports for the reports table.
--
-- COMPATIBILITY
--   Additive + idempotent. Safe to re-run.
-- ============================================================================

-- 1) Owner-gated RPC: delete the latest active announcement and audit it.
create or replace function public.admin_remove_announcement()
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_owner();
  -- The "current" announcement = the newest active row (same ordering clients use in
  -- getActiveAnnouncements: created_at desc). Deleting this single row clears what
  -- every connected device is currently showing.
  select id into v_id
  from public.announcements
  where active = true
  order by created_at desc
  limit 1;
  if v_id is null then return null; end if;
  delete from public.announcements where id = v_id;
  perform public._audit('remove_announcement', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

grant execute on function public.admin_remove_announcement() to authenticated;

-- 2) Realtime: publish announcements so clients can drop the banner live.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;
