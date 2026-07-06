-- 0021_status_media_privacy.sql — Status: audio + captions + text color,
-- 36-hour lifetime, and WhatsApp-style SERVER-ENFORCED privacy.
-- ============================================================================
-- WHAT THIS DOES
--   • Extends public.statuses: adds 'audio' type, caption, text_color,
--     duration_ms, and an `audience` column (everyone/contacts/except/only).
--   • Adds public.status_audience — the per-status snapshot of the Except /
--     Only-Share-With member list.
--   • Adds two SECURITY DEFINER helpers, public._are_contacts() and
--     public._can_view_status(), and REWRITES the statuses read policy to
--     enforce audience + blocking server-side (was: any authenticated user
--     could read every non-expired status).
--   • Changes the status lifetime default 24h → 36h and migrates live rows.
--   • Adds owner update/delete storage policies on the `status` bucket.
--   • Adds public.purge_expired_statuses() for opportunistic physical cleanup.
--
-- WHAT IT DOES NOT DO
--   • Does NOT change status_views, insert/delete policies on statuses, or any
--     unrelated table. Realtime publication membership is unchanged (statuses
--     and status_views were already added in 0002 / 0012).
--
-- CONTACT DEFINITION
--   Two users are "contacts" iff they share a type='direct' conversation.
--   Blocked users (either direction) never see each other's statuses.
--
-- COMPATIBILITY
--   Additive + idempotent. Safe to re-run. Existing image/text/video statuses
--   default to audience='everyone' (prior behaviour preserved for them).
-- ============================================================================

-- 1) 36-hour lifetime: new default + migrate currently-active rows.
alter table public.statuses alter column expires_at set default (now() + interval '36 hours');
update public.statuses set expires_at = created_at + interval '36 hours' where expires_at > now();

-- 2) New media type + columns.
alter table public.statuses drop constraint if exists statuses_type_check;
alter table public.statuses
  add constraint statuses_type_check check (type in ('image', 'text', 'video', 'audio'));

alter table public.statuses add column if not exists caption     text;    -- image/video/audio caption
alter table public.statuses add column if not exists text_color  text;    -- custom text-status color
alter table public.statuses add column if not exists duration_ms integer; -- audio/video length (viewer)
alter table public.statuses add column if not exists audience    text not null default 'everyone'
  check (audience in ('everyone', 'contacts', 'except', 'only'));

-- 3) Per-status audience snapshot (Except / Only Share With member lists).
create table if not exists public.status_audience (
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (status_id, user_id)
);
create index if not exists idx_status_audience_user on public.status_audience(user_id);

alter table public.status_audience enable row level security;

-- Only the status owner reads/writes its audience list. Viewers never need to
-- read this table directly — enforcement happens in _can_view_status (definer).
drop policy if exists "owner manage audience" on public.status_audience;
create policy "owner manage audience" on public.status_audience
  for all to authenticated
  using      (exists (select 1 from public.statuses s where s.id = status_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.statuses s where s.id = status_id and s.user_id = auth.uid()));

-- 4) Privacy helpers (SECURITY DEFINER → bypass RLS on the tables they read,
--    which prevents recursion when called from the statuses read policy).

-- Two users share a 1:1 (direct) conversation.
create or replace function public._are_contacts(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants p1
    join public.conversation_participants p2 on p2.conversation_id = p1.conversation_id
    join public.conversations c            on c.id = p1.conversation_id
    where c.type = 'direct' and p1.user_id = a and p2.user_id = b and a <> b
  );
$$;

-- Can the current user (auth.uid()) view a status with these attributes?
create or replace function public._can_view_status(s_user_id uuid, s_audience text, s_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
    -- Never leak across a block, in either direction.
    not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = s_user_id and b.blocked_id = auth.uid())
         or (b.blocker_id = auth.uid()  and b.blocked_id = s_user_id)
    )
    and (
      s_user_id = auth.uid()  -- always see your own
      or case s_audience
        when 'everyone' then true
        when 'contacts' then public._are_contacts(s_user_id, auth.uid())
        when 'only'     then exists (
          select 1 from public.status_audience a where a.status_id = s_id and a.user_id = auth.uid())
        when 'except'   then public._are_contacts(s_user_id, auth.uid())
          and not exists (
            select 1 from public.status_audience a where a.status_id = s_id and a.user_id = auth.uid())
        else false
      end
    );
$$;

grant execute on function public._are_contacts(uuid, uuid)             to authenticated;
grant execute on function public._can_view_status(uuid, text, uuid)   to authenticated;

-- 5) Rewrite the statuses read policy to enforce privacy server-side.
drop policy if exists "read statuses" on public.statuses;
create policy "read statuses" on public.statuses
  for select to authenticated
  using (expires_at > now() and public._can_view_status(user_id, audience, id));

-- 6) Storage: allow the owner to replace/remove their own status media.
drop policy if exists "status owner update" on storage.objects;
create policy "status owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'status' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "status owner delete" on storage.objects;
create policy "status owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'status' and (storage.foldername(name))[1] = auth.uid()::text);

-- 7) Opportunistic physical cleanup of expired statuses. RLS already hides
--    them; this frees rows/storage refs. Clients may call it on load; schedule
--    via pg_cron in production. SECURITY DEFINER so it can delete any expired row.
create or replace function public.purge_expired_statuses()
returns integer language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with deleted as (
    delete from public.statuses where expires_at <= now() returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

grant execute on function public.purge_expired_statuses() to authenticated;
