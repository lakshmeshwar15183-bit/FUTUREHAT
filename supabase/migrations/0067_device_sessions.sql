-- 0067_device_sessions.sql
-- WhatsApp-style device session management.
--
-- Adds public.user_sessions, a per-login registry keyed on the JWT session_id
-- claim (== auth.sessions.id, stable across token refreshes). Clients register
-- on launch/foreground via register_session(), which also enforces a 2-phone
-- limit: logging in on a 3rd phone soft-revokes the oldest phone session
-- (platform android/ios only — web logins never count toward the limit).
--
-- Revocation model:
--   * Soft (guaranteed): revoked_at/revoked_reason set; clients self-enforce
--     via realtime + foreground re-register + mount check (same philosophy as
--     the profiles.force_logout_at pulse in shared/forceLogout.ts).
--   * Hard (best-effort): delete from auth.sessions where id = <sid> inside an
--     exception-swallowing block. auth.refresh_tokens cascades, killing the
--     session's refresh; access token dies at expiry (<= 60 min). Hosted
--     Supabase may deny DML on the auth schema — the guard degrades cleanly
--     to soft-only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) user_sessions table
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  device_label text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists user_sessions_user_platform_idx
  on public.user_sessions (user_id, platform, revoked_at);

alter table public.user_sessions enable row level security;

-- Read own sessions only. No insert/update/delete policies — every write goes
-- through the SECURITY DEFINER RPCs below so session_id can never be spoofed.
drop policy if exists "read own sessions" on public.user_sessions;
create policy "read own sessions" on public.user_sessions
  for select using (auth.uid() = user_id);

grant select on public.user_sessions to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) security_events: allow device_signed_out kind
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.security_events
  drop constraint if exists security_events_kind_check;

alter table public.security_events
  add constraint security_events_kind_check
  check (kind in (
    'login', 'logout', 'password_change', 'new_device',
    'twofa_enabled', 'twofa_disabled', 'email_change', 'device_signed_out'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Internal helper: best-effort hard revoke of a GoTrue session
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.try_kill_auth_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from auth.sessions where id = p_session_id;
  exception when others then
    null; -- hosted projects may deny auth-schema DML; soft revoke still applies
  end;
end;
$$;

revoke all on function public.try_kill_auth_session(uuid) from public;
-- executed only from the definer functions below; no direct client grants

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) register_session — register/heartbeat + 2-phone limit enforcement
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.register_session(p_platform text, p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  my_revoked_at timestamptz;
  my_revoked_reason text;
  victim record;
begin
  if uid is null or sid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'bad_platform';
  end if;

  -- Serialize per-user so two simultaneous 3rd-phone logins can't both pass
  -- the limit check.
  perform pg_advisory_xact_lock(hashtext(uid::text));

  insert into public.user_sessions (session_id, user_id, platform, device_label)
  values (sid, uid, p_platform, left(p_device_label, 120))
  on conflict (session_id) do update
    set last_seen = now(),
        device_label = coalesce(excluded.device_label, user_sessions.device_label);

  -- If this very session was revoked (limit hit while backgrounded, or remote
  -- sign-out), tell the caller so it signs itself out.
  select revoked_at, revoked_reason into my_revoked_at, my_revoked_reason
  from public.user_sessions where session_id = sid;
  if my_revoked_at is not null then
    return jsonb_build_object('revoked', true, 'reason', my_revoked_reason);
  end if;

  -- 2-phone limit: revoke everything beyond the 2 newest phone sessions.
  if p_platform in ('android', 'ios') then
    for victim in
      select session_id from public.user_sessions
      where user_id = uid
        and platform in ('android', 'ios')
        and revoked_at is null
      order by created_at desc
      offset 2
    loop
      update public.user_sessions
      set revoked_at = now(), revoked_reason = 'phone_limit'
      where session_id = victim.session_id;

      perform public.try_kill_auth_session(victim.session_id);

      begin
        insert into public.security_events (user_id, kind, user_agent)
        values (uid, 'device_signed_out', 'phone_limit');
      exception when others then
        null; -- never block login on audit failure
      end;
    end loop;
  end if;

  -- Housekeeping: drop long-revoked and long-stale rows so ghosts never hold
  -- phone slots or clutter the device list.
  delete from public.user_sessions
  where user_id = uid
    and (
      (revoked_at is not null and revoked_at < now() - interval '30 days')
      or (revoked_at is null and last_seen < now() - interval '60 days')
    );

  return jsonb_build_object('revoked', false);
end;
$$;

revoke all on function public.register_session(text, text) from public;
grant execute on function public.register_session(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) revoke_session — sign out one of my other devices
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.revoke_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  target_user uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_session_id = sid then
    raise exception 'cannot_revoke_own_session'; -- use normal sign-out instead
  end if;

  select user_id into target_user
  from public.user_sessions where session_id = p_session_id;
  if target_user is null or target_user <> uid then
    raise exception 'not_found';
  end if;

  update public.user_sessions
  set revoked_at = now(), revoked_reason = 'remote'
  where session_id = p_session_id and revoked_at is null;

  perform public.try_kill_auth_session(p_session_id);

  begin
    insert into public.security_events (user_id, kind, user_agent)
    values (uid, 'device_signed_out', 'remote');
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.revoke_session(uuid) from public;
grant execute on function public.revoke_session(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) unregister_session — remove own row on normal local sign-out
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.unregister_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if sid is null then
    return jsonb_build_object('ok', false);
  end if;
  delete from public.user_sessions where session_id = sid;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unregister_session() from public;
grant execute on function public.unregister_session() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) logout_all_devices v2 — also soft-revoke user_sessions (except caller's)
-- ─────────────────────────────────────────────────────────────────────────────
-- Keeps the existing contract (force_logout_at stamp, devices wipe, audit,
-- return shape). Excluding the caller's own session preserves changePassword
-- semantics: the current session survives via the decideForceLogout ack.

create or replace function public.logout_all_devices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  victim record;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.profiles
  set force_logout_at = now()
  where id = uid;

  delete from public.devices where user_id = uid;

  for victim in
    select session_id from public.user_sessions
    where user_id = uid
      and revoked_at is null
      and (sid is null or session_id <> sid)
  loop
    update public.user_sessions
    set revoked_at = now(), revoked_reason = 'logout_all'
    where session_id = victim.session_id;

    perform public.try_kill_auth_session(victim.session_id);
  end loop;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Realtime — revoked devices learn about it within ~1s while foregrounded
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_sessions'
  ) then
    alter publication supabase_realtime add table public.user_sessions;
  end if;
exception when others then
  -- publication may already include the table or lack privileges in some envs
  null;
end $$;
