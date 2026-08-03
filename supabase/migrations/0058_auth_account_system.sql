-- 0058_auth_account_system.sql
-- Production account model (zero-break migration):
--   • Permanent Lumixo user id remains profiles.id (= auth.users.id)
--   • Email (auth.users) is primary identity; no SMS OTP
--   • Optional phone stored as E.164 + hash for contact discovery only
--   • phone never exposed on public_profiles
--   • Discover contacts by hash only (never raw contact lists)
--   • Self logout-all-devices via force_logout_at + devices cleanup
-- Existing chats, media, premium, settings stay on the same UUID.

-- ---------------------------------------------------------------------------
-- 1) Columns: phone_e164 + phone_hash (phone kept in sync for legacy admin)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone_e164 text,
  add column if not exists phone_hash text,
  add column if not exists phone_updated_at timestamptz,
  add column if not exists email_normalized text;

-- Unique when present (partial unique indexes — allow many NULLs)
create unique index if not exists profiles_phone_e164_uidx
  on public.profiles (phone_e164)
  where phone_e164 is not null;

create unique index if not exists profiles_phone_hash_uidx
  on public.profiles (phone_hash)
  where phone_hash is not null;

create index if not exists profiles_phone_hash_lookup_idx
  on public.profiles (phone_hash)
  where phone_hash is not null
    and deleted_at is null
    and coalesce(account_status, 'active') not in ('banned', 'disabled');

-- email_normalized is denormalized from auth for ops only (not a second identity)
create unique index if not exists profiles_email_normalized_uidx
  on public.profiles (email_normalized)
  where email_normalized is not null;

comment on column public.profiles.phone_e164 is
  'Own-only E.164 phone for optional recovery; never returned by public_profiles.';
comment on column public.profiles.phone_hash is
  'SHA-256 hex of lumixo-phone-v1:E.164 for contact discovery matching.';

-- ---------------------------------------------------------------------------
-- 2) Hash helper (must match shared/phone.ts)
-- ---------------------------------------------------------------------------
create or replace function public.phone_discovery_hash(p_e164 text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(digest('lumixo-phone-v1:' || p_e164, 'sha256'), 'hex');
$$;

revoke all on function public.phone_discovery_hash(text) from public;
grant execute on function public.phone_discovery_hash(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Basic E.164 validator (+ and 8–15 digits total after +)
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_e164(p text)
returns boolean
language sql
immutable
as $$
  select p is not null
    and p ~ '^\+[1-9][0-9]{7,14}$';
$$;

-- ---------------------------------------------------------------------------
-- 4) Keep phone / phone_e164 / phone_hash consistent on write
-- ---------------------------------------------------------------------------
create or replace function public.profiles_sync_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e164 text;
begin
  -- Prefer phone_e164 if set; else legacy phone column.
  e164 := nullif(btrim(coalesce(NEW.phone_e164, NEW.phone, '')), '');

  if e164 is null then
    NEW.phone := null;
    NEW.phone_e164 := null;
    NEW.phone_hash := null;
    if TG_OP = 'UPDATE'
       and (OLD.phone is not null or OLD.phone_e164 is not null or OLD.phone_hash is not null)
    then
      NEW.phone_updated_at := now();
    end if;
    return NEW;
  end if;

  if not public.is_valid_e164(e164) then
    raise exception 'invalid_phone_e164' using errcode = '22023';
  end if;

  NEW.phone := e164;
  NEW.phone_e164 := e164;
  NEW.phone_hash := public.phone_discovery_hash(e164);

  if TG_OP = 'INSERT'
     or NEW.phone_e164 is distinct from OLD.phone_e164
     or NEW.phone is distinct from OLD.phone
  then
    NEW.phone_updated_at := now();
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_profiles_sync_phone on public.profiles;
create trigger trg_profiles_sync_phone
  before insert or update of phone, phone_e164, phone_hash
  on public.profiles
  for each row
  execute function public.profiles_sync_phone();

-- ---------------------------------------------------------------------------
-- 5) Backfill existing plaintext phones that already look like E.164
-- ---------------------------------------------------------------------------
update public.profiles p
set phone_e164 = btrim(p.phone),
    phone = btrim(p.phone)
where p.phone is not null
  and p.phone_e164 is null
  and public.is_valid_e164(btrim(p.phone));

-- Strip clearly invalid phone values so unique/constraint path stays clean
-- (do not delete valid-looking free-text; leave for user to re-enter)
update public.profiles p
set phone = null
where p.phone is not null
  and p.phone_e164 is null
  and not public.is_valid_e164(btrim(p.phone))
  and btrim(p.phone) !~ '^\+';

-- ---------------------------------------------------------------------------
-- 6) handle_new_user: email-primary metadata, optional phone from signup meta
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
  v_email text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    'Lumixo user'
  );
  v_phone := nullif(btrim(coalesce(
    new.raw_user_meta_data->>'phone_e164',
    new.raw_user_meta_data->>'phone',
    new.phone
  )), '');
  v_email := nullif(lower(btrim(coalesce(new.email, ''))), '');

  insert into public.profiles (id, display_name, phone, phone_e164, email_normalized)
  values (
    new.id,
    v_name,
    case when public.is_valid_e164(v_phone) then v_phone else null end,
    case when public.is_valid_e164(v_phone) then v_phone else null end,
    v_email
  )
  on conflict (id) do update set
    display_name = coalesce(nullif(btrim(public.profiles.display_name), ''), excluded.display_name),
    email_normalized = coalesce(public.profiles.email_normalized, excluded.email_normalized);

  -- Developer accounts get lifetime premium immediately.
  perform public.provision_developer(new.id);
  return new;
exception
  when unique_violation then
    -- Phone already taken: still create profile without phone (never block signup).
    insert into public.profiles (id, display_name, email_normalized)
    values (new.id, v_name, v_email)
    on conflict (id) do nothing;
    perform public.provision_developer(new.id);
    return new;
  when others then
    -- Never fail auth.users insert due to profile side-effects.
    insert into public.profiles (id, display_name, email_normalized)
    values (new.id, coalesce(v_name, 'Lumixo user'), v_email)
    on conflict (id) do nothing;
    begin
      perform public.provision_developer(new.id);
    exception when others then
      null;
    end;
    return new;
end;
$$;

-- Backfill email_normalized for existing users (best-effort)
update public.profiles p
set email_normalized = lower(btrim(u.email))
from auth.users u
where u.id = p.id
  and p.email_normalized is null
  and u.email is not null;

-- ---------------------------------------------------------------------------
-- 7) set_my_phone — validated E.164; clears hash when null
-- ---------------------------------------------------------------------------
create or replace function public.set_my_phone(p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  e164 text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  e164 := nullif(btrim(coalesce(p_phone, '')), '');

  if e164 is null then
    update public.profiles
    set phone = null, phone_e164 = null, phone_hash = null, phone_updated_at = now()
    where id = uid;
    return jsonb_build_object('ok', true, 'phone_e164', null);
  end if;

  if not public.is_valid_e164(e164) then
    raise exception 'invalid_phone_e164' using errcode = '22023';
  end if;

  -- Conflict if another account holds this number
  if exists (
    select 1 from public.profiles
    where phone_e164 = e164 and id <> uid
  ) then
    raise exception 'phone_taken' using errcode = '23505';
  end if;

  update public.profiles
  set phone = e164, phone_e164 = e164
  where id = uid;

  return jsonb_build_object('ok', true, 'phone_e164', e164);
end;
$$;

revoke all on function public.set_my_phone(text) from public;
grant execute on function public.set_my_phone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Contact discovery rate limit table
-- ---------------------------------------------------------------------------
create table if not exists public.contact_discovery_rate (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  request_count int not null default 0,
  last_request_at timestamptz not null default now()
);

alter table public.contact_discovery_rate enable row level security;
-- no client policies — service/security definer only

-- ---------------------------------------------------------------------------
-- 9) discover_contacts — match phone hashes only; return public profile fields
-- ---------------------------------------------------------------------------
create or replace function public.discover_contacts(p_hashes text[])
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  about text,
  phone_hash text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text[];
  cnt int;
  win_start timestamptz;
  req_count int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Sanitize: hex sha256 only, cap batch size
  cleaned := array(
    select distinct lower(h)
    from unnest(coalesce(p_hashes, '{}'::text[])) as h
    where h ~ '^[0-9a-fA-F]{64}$'
    limit 500
  );
  cnt := coalesce(cardinality(cleaned), 0);
  if cnt = 0 then
    return;
  end if;

  -- Rate limit: 40 requests / rolling hour
  insert into public.contact_discovery_rate as cdr (user_id, window_start, request_count, last_request_at)
  values (uid, now(), 1, now())
  on conflict (user_id) do update
  set
    window_start = case
      when cdr.window_start < now() - interval '1 hour'
        then now()
      else cdr.window_start
    end,
    request_count = case
      when cdr.window_start < now() - interval '1 hour'
        then 1
      else cdr.request_count + 1
    end,
    last_request_at = now()
  returning cdr.window_start, cdr.request_count into win_start, req_count;

  if req_count > 40 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- phone_hash is returned only for hashes the caller already submitted
  -- (lets the client attach local contact names). Raw phone is never returned.
  -- Qualify OUT columns to avoid PL/pgSQL ambiguous "user_id" / "phone_hash".
  return query
  select
    p.id as user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.about,
    p.phone_hash
  from public.profiles p
  where p.phone_hash = any (cleaned)
    and p.id <> uid
    and p.deleted_at is null
    and coalesce(p.account_status, 'active') not in ('banned', 'disabled')
  limit 200;
end;
$$;

revoke all on function public.discover_contacts(text[]) from public;
grant execute on function public.discover_contacts(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) logout_all_devices — user-initiated multi-device sign-out signal
-- ---------------------------------------------------------------------------
create or replace function public.logout_all_devices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.profiles
  set force_logout_at = now()
  where id = uid;

  delete from public.devices where user_id = uid;

  begin
    insert into public.security_events (user_id, kind, user_agent)
    values (uid, 'logout', 'logout_all_devices');
  exception when others then
    null; -- never block logout on audit insert failure
  end;

  return jsonb_build_object('ok', true, 'force_logout_at', now());
end;
$$;

revoke all on function public.logout_all_devices() from public;
grant execute on function public.logout_all_devices() to authenticated;

-- ---------------------------------------------------------------------------
-- 11) public_profiles stays phone-free (re-assert)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 12) Own phone read helper (never phone_hash to client if avoidable; e164 ok for self)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  em text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into p from public.profiles where id = uid;
  select email into em from auth.users where id = uid;

  return jsonb_build_object(
    'id', p.id,
    'email', em,
    'email_confirmed', exists (
      select 1 from auth.users u
      where u.id = uid and u.email_confirmed_at is not null
    ),
    'display_name', p.display_name,
    'username', p.username,
    'about', p.about,
    'avatar_url', p.avatar_url,
    'phone_e164', p.phone_e164,
    'has_phone', p.phone_e164 is not null,
    'created_at', p.created_at,
    'last_seen', p.last_seen
  );
end;
$$;

revoke all on function public.get_my_account() from public;
grant execute on function public.get_my_account() to authenticated;
