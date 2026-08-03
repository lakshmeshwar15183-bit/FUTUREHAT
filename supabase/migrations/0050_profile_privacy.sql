-- 0050_profile_privacy.sql
-- P0: stop authenticated clients enumerating phone / moderation fields via SELECT *.
-- Discovery uses public_profiles (definer). Own full row remains readable for settings.

-- 1) public_profiles as security definer-style view (owner rights) so row RLS
--    on profiles can be tightened without breaking contact discovery.
create or replace view public.public_profiles
with (security_invoker = false)
as
  select
    id,
    username,
    display_name,
    about,
    avatar_url,
    last_seen,
    created_at
  from public.profiles
  where deleted_at is null
    and coalesce(account_status, 'active') not in ('banned', 'disabled');

grant select on public.public_profiles to authenticated;

-- 2) Restrict base table SELECT: own row OR admin (no more using (true) full dump).
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin(auth.uid())
  );

-- 3) Column grants: even with SELECT on own row, never expose phone to bulk
--    REST unless needed. Authenticated retains select on non-PII columns only
--    for defense-in-depth when policies widen later. Full row for self still
--    requires granted columns — grant phone only in combination with RLS own-row.
revoke select on table public.profiles from anon;
-- Keep authenticated select (RLS filters rows); grant includes phone for own
-- account screens (RLS ensures only self/admin).
grant select on table public.profiles to authenticated;
