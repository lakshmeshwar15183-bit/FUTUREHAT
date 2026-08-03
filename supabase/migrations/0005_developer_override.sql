-- 0005_developer_override.sql — Permanent developer override (lifetime Premium + Admin)
-- ============================================================================
-- WHAT THIS DOES
--   Grants lifetime Lumixo+ Premium and Admin/developer privileges to a fixed
--   allowlist of emails, bypassing all payment / subscription / Razorpay checks —
--   for those emails ONLY. Every other user follows the normal flow unchanged.
--
-- WHY IT'S AT THE DATABASE LAYER
--   `is_premium(uid)` is the single gate consulted by RLS (hidden/scheduled
--   chats), the AI edge function, the premium badge view, and any FUTURE premium
--   feature. Overriding it here means new premium features are covered with no
--   additional code. The override lives in a table, so it survives deploys.
--
-- SECURITY (important)
--   * `developer_accounts` is RLS-locked with NO policies and has all client
--     grants REVOKED, so no authenticated user can read it or insert their own
--     email to self-grant premium/admin. Only service_role / migrations can edit.
--   * Admin status is derived from that protected allowlist via a SECURITY
--     DEFINER function — there is no client-writable "is_admin" column to abuse.
--   * Helper functions pin search_path and are SECURITY DEFINER only so they can
--     read auth.users for the email match; they expose booleans only.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- 1) The permanent override store. ------------------------------------------------
create table if not exists public.developer_accounts (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- Lock it down. RLS on + zero policies = deny all to anon/authenticated. Also
-- revoke the broad DML that 0004_grants applies to public tables (incl. via
-- default privileges to future tables). Only service_role / postgres may touch it.
alter table public.developer_accounts enable row level security;
revoke all on public.developer_accounts from anon, authenticated;

-- Seed the developer allowlist (store lowercased; matching is case-insensitive).
insert into public.developer_accounts (email, note) values
  ('lakshmeshwar15183@gmail.com', 'Primary developer — lifetime premium + admin')
on conflict (email) do nothing;

-- 2) Is this user a registered developer? (reads auth.users via definer rights) --
create or replace function public.is_developer(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.developer_accounts d on lower(u.email) = lower(d.email)
    where u.id = uid
  );
$$;

-- 3) Premium = developer OR an active paid subscription. ------------------------
--    This OR is what makes the override apply everywhere is_premium is used,
--    including premium features added later, with no further changes.
create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_developer(uid)
      or exists (
        select 1 from public.subscriptions s
        where s.user_id = uid
          and s.status = 'active'
          and s.current_period_end > now()
      );
$$;

-- 4) Admin/developer privilege check (derived from the protected allowlist). ----
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_developer(uid);
$$;

-- 5) Allow a self-documenting 'developer' provider on the lifetime row. ---------
alter table public.subscriptions drop constraint if exists subscriptions_provider_check;
alter table public.subscriptions add constraint subscriptions_provider_check
  check (provider in ('razorpay','stripe','manual','developer'));

-- 6) Provision a developer: give them a lifetime subscription row so the existing
--    client (which reads the subscription) shows Premium with zero client changes.
--    Far-future end date (NOT 'infinity', which breaks JS Date parsing). Idempotent.
create or replace function public.provision_developer(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_developer(uid) then
    return;
  end if;
  insert into public.subscriptions (
    user_id, plan, status, provider, amount_inr,
    current_period_start, current_period_end, cancel_at_period_end
  ) values (
    uid, 'yearly', 'active', 'developer', 0,
    now(), timestamptz '2099-12-31 00:00:00+00', false
  )
  on conflict (user_id) do update set
    status               = 'active',
    provider             = 'developer',
    current_period_end   = timestamptz '2099-12-31 00:00:00+00',
    cancel_at_period_end = false,
    updated_at           = now();
end;
$$;

-- 7) Provision automatically on first login (signup creates the auth user, which
--    fires this trigger function). Re-defines handle_new_user to add the call.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, display_name)
  values (new.id, new.phone, coalesce(new.raw_user_meta_data->>'display_name', 'Lumixo user'))
  on conflict (id) do nothing;
  -- Developer accounts get lifetime premium immediately, no payment required.
  perform public.provision_developer(new.id);
  return new;
end;
$$;
-- (trigger on_auth_user_created from 0001 already points at handle_new_user)

-- 8) Backfill: if a developer account already exists, provision it now. ---------
do $$
declare r record;
begin
  for r in
    select u.id
    from auth.users u
    join public.developer_accounts d on lower(u.email) = lower(d.email)
  loop
    insert into public.profiles (id, display_name)
    values (r.id, 'Lumixo Developer')
    on conflict (id) do nothing;
    perform public.provision_developer(r.id);
  end loop;
end $$;

-- 9) Let clients call the gate functions for themselves (booleans only). --------
grant execute on function public.is_developer(uuid) to authenticated;
grant execute on function public.is_admin(uuid)     to authenticated;
grant execute on function public.is_premium(uuid)   to authenticated;
