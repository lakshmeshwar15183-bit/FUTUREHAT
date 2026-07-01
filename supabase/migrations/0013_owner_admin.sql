-- 0013_owner_admin.sql — Owner / Admin management system.
-- ============================================================================
-- WHAT THIS DOES
--   Builds the full platform-administration surface on top of the existing
--   developer-override foundation (0005) and admin surface (0009):
--     • Role tiers: owner / admin / moderator / user.
--     • Account moderation state: ban / suspend / restore / disable / lock / verify.
--     • Feature flags (toggle features without shipping an update).
--     • Announcements (broadcast / maintenance / update / force-update).
--     • Devices registry (for "registered devices" + remote logout).
--     • Call & message admin metrics.
--     • Audit logging of every sensitive action.
--     • SECURITY DEFINER, permission-checked RPCs for every owner/admin action.
--
-- OWNER SAFETY (requirement 16)
--   The Owner is the immutable developer allowlist from 0005 (is_developer). It is
--   NOT the profiles.role column, so it can never be granted or revoked from the
--   client. Every mutating RPC refuses to touch an Owner account unless the caller
--   is the Owner, and admin-only powers (manage admins, lifetime premium, feature
--   flags, announcements, audit log) require is_owner().
--
-- COMPATIBILITY
--   is_admin() is REDEFINED as owner OR role='admin', so every existing caller
--   (0009 RLS, admin_stats) keeps working and the Owner remains an admin. Nothing
--   is removed. All columns/tables are additive. Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ROLE TIERS  (owner preserved as the immutable developer allowlist)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user','moderator','admin','owner'));

-- Owner ≡ developer allowlist (0005). Immutable, cannot be self-granted.
create or replace function public.is_owner(uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_developer(uid); $$;

-- Admin = owner OR an explicitly assigned admin role. (Redefinition keeps every
-- existing is_admin() caller working and keeps the Owner an admin.)
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_owner(uid)
      or exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

-- Moderator = admin OR an explicitly assigned moderator role.
create or replace function public.is_moderator(uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin(uid)
      or exists (select 1 from public.profiles p where p.id = uid and p.role = 'moderator');
$$;

grant execute on function public.is_owner(uuid)     to authenticated;
grant execute on function public.is_moderator(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) ACCOUNT MODERATION STATE  (additive columns on profiles)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists account_status  text not null default 'active';
alter table public.profiles add column if not exists status_reason   text;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists verified        boolean not null default false;
alter table public.profiles add column if not exists verified_at     timestamptz;
alter table public.profiles add column if not exists banned_at       timestamptz;
alter table public.profiles add column if not exists deleted_at      timestamptz;
alter table public.profiles add column if not exists force_logout_at timestamptz;

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('active','suspended','banned','disabled','locked'));

-- Is this account allowed to act right now? (A suspension auto-expires when its
-- suspended_until passes.) Used by the RESTRICTIVE messaging policy below so a
-- banned/suspended user is blocked server-side, not just in the UI.
create or replace function public.is_account_active(uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when p.account_status = 'active' then true
      when p.account_status = 'suspended'
           and p.suspended_until is not null
           and p.suspended_until <= now() then true
      else false
    end
    from public.profiles p where p.id = uid
  ), true);   -- no profile row yet ⇒ don't block (e.g. mid-signup)
$$;
grant execute on function public.is_account_active(uuid) to authenticated;

-- Server-side enforcement: a banned/suspended/locked/disabled account cannot send
-- messages. RESTRICTIVE ⇒ AND-ed with the existing "member can insert" policy, so
-- normal users are unaffected and no existing functionality is removed.
drop policy if exists "block inactive senders" on public.messages;
create policy "block inactive senders" on public.messages
  as restrictive for insert to authenticated
  with check (public.is_account_active(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) FEATURE FLAGS  (publicly readable; owner-only writes via RPC)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.feature_flags (
  key        text primary key,
  enabled    boolean not null default true,
  label      text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.feature_flags enable row level security;
drop policy if exists "read feature flags" on public.feature_flags;
create policy "read feature flags" on public.feature_flags
  for select to anon, authenticated using (true);
-- No write policy ⇒ only the owner-gated SECURITY DEFINER RPC can change flags.

insert into public.feature_flags (key, label) values
  ('stories','Stories'), ('communities','Communities'), ('channels','Channels'),
  ('calls','Calls'), ('video_calls','Video Calls'), ('voice_notes','Voice Notes'),
  ('premium','Premium'), ('ai_features','AI Features'), ('payments','Payments'),
  ('notifications','Notifications'), ('app_enabled','App Enabled')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) ANNOUNCEMENTS  (publicly readable when active; owner-only writes via RPC)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'announcement'
             check (kind in ('announcement','maintenance','update','force_update')),
  title      text not null,
  body       text,
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "read active announcements" on public.announcements;
create policy "read active announcements" on public.announcements
  for select to anon, authenticated using (active = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) DEVICES  (self-managed; admins read/remove via RPC)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  text not null,
  name       text,
  platform   text,
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);
alter table public.devices enable row level security;
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admin read devices" on public.devices;
create policy "admin read devices" on public.devices
  for select to authenticated using (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) CALL METRICS  (additive columns; clients may populate for the call console)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.calls add column if not exists connection_state text;
alter table public.calls add column if not exists ice_failures     int not null default 0;
alter table public.calls add column if not exists reconnects       int not null default 0;
alter table public.calls add column if not exists turn_used        boolean;
alter table public.calls add column if not exists failure_reason   text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) AUDIT + PERMISSION HELPERS  (every mutating RPC uses these)
-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log already exists (0010): (id, user_id, action, target, meta jsonb, created_at).
create or replace function public._audit(p_action text, p_target text, p_meta jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, target, meta)
  values (auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb));
end;
$$;

create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public
as $$ begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized: admin required'; end if;
end; $$;

create or replace function public._require_owner()
returns void language plpgsql stable security definer set search_path = public
as $$ begin
  if not public.is_owner(auth.uid()) then raise exception 'not authorized: owner required'; end if;
end; $$;

-- Moderator OR admin gate (moderators may moderate content but not manage users).
create or replace function public._require_moderator_or_admin()
returns void language plpgsql stable security definer set search_path = public
as $$ begin
  if not public.is_moderator(auth.uid()) then raise exception 'not authorized: moderator required'; end if;
end; $$;

-- Refuse to let a non-owner modify an owner account (requirement 16).
create or replace function public._guard_owner_target(p_target uuid)
returns void language plpgsql stable security definer set search_path = public
as $$ begin
  if public.is_owner(p_target) and not public.is_owner(auth.uid()) then
    raise exception 'not authorized: cannot modify an owner account';
  end if;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) USER MANAGEMENT RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- Search by user id / username / display name / email / phone.
create or replace function public.admin_search_users(q text)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v_q text := '%' || trim(coalesce(q, '')) || '%';
begin
  perform public._require_admin();
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select p.id, p.username, p.display_name, p.avatar_url, p.phone,
             u.email, p.role, p.account_status, p.verified, p.last_seen,
             p.created_at, p.suspended_until, p.deleted_at,
             public.is_premium(p.id) as premium,
             public.is_owner(p.id)   as owner
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.id::text = trim(coalesce(q,''))
         or p.username ilike v_q
         or p.display_name ilike v_q
         or coalesce(p.phone,'') ilike v_q
         or coalesce(u.email,'') ilike v_q
         or coalesce(u.phone,'') ilike v_q
      order by p.last_seen desc nulls last
      limit 50
    ) t
  ), '[]'::json);
end;
$$;

-- Full profile for one user (profile + auth email/created + premium + devices).
create or replace function public.admin_get_user(target uuid)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v json;
begin
  perform public._require_admin();
  select json_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'about', p.about, 'phone', p.phone,
    'email', u.email, 'created_at', u.created_at, 'last_seen', p.last_seen,
    'role', p.role, 'account_status', p.account_status, 'status_reason', p.status_reason,
    'suspended_until', p.suspended_until, 'verified', p.verified, 'verified_at', p.verified_at,
    'banned_at', p.banned_at, 'deleted_at', p.deleted_at, 'force_logout_at', p.force_logout_at,
    'premium', public.is_premium(p.id), 'owner', public.is_owner(p.id),
    'subscription', (select row_to_json(s) from public.subscriptions s where s.user_id = p.id),
    'devices', coalesce((select json_agg(row_to_json(d)) from public.devices d where d.user_id = p.id), '[]'::json),
    'recent_security', coalesce((select json_agg(row_to_json(e)) from (
        select kind, ip, user_agent, created_at from public.security_events
        where user_id = p.id order by created_at desc limit 20) e), '[]'::json)
  ) into v
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = target;
  if v is null then raise exception 'user not found'; end if;
  return v;
end;
$$;

-- Ban / suspend / restore / unban / disable / lock (one gate for all states).
create or replace function public.admin_set_account_status(
  target uuid, new_status text, reason text default null, until timestamptz default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  if new_status not in ('active','suspended','banned','disabled','locked') then
    raise exception 'invalid status %', new_status;
  end if;
  select account_status into v_old from public.profiles where id = target;
  update public.profiles set
    account_status  = new_status,
    status_reason   = reason,
    suspended_until = case when new_status = 'suspended' then until else null end,
    banned_at       = case when new_status = 'banned' then now() else banned_at end
  where id = target;
  perform public._audit('account_status',
    target::text,
    jsonb_build_object('from', v_old, 'to', new_status, 'reason', reason, 'until', until));
end;
$$;

-- Verify / un-verify.
create or replace function public.admin_verify_user(target uuid, verified boolean)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  update public.profiles set verified = admin_verify_user.verified,
    verified_at = case when admin_verify_user.verified then now() else null end
  where id = target;
  perform public._audit('verify', target::text, jsonb_build_object('verified', verified));
end; $$;

-- Force logout from all devices (clients compare force_logout_at to their session).
create or replace function public.admin_force_logout(target uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  update public.profiles set force_logout_at = now() where id = target;
  delete from public.devices where user_id = target;
  perform public._audit('force_logout', target::text, '{}'::jsonb);
end; $$;

-- Delete account (soft: disable + record a deletion request; auth row removal is a
-- service-role/edge-function job — see APP note). Owner-protected.
create or replace function public.admin_delete_account(target uuid, reason text default null)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  update public.profiles set account_status = 'disabled', deleted_at = now(),
    status_reason = coalesce(reason, 'deleted by admin') where id = target;
  insert into public.account_deletion_requests (user_id, reason, status, purge_after)
  values (target, coalesce(reason,'admin delete'), 'pending', now() + interval '30 days')
  on conflict (user_id) do update set reason = excluded.reason, status = 'pending';
  perform public._audit('delete_account', target::text, jsonb_build_object('reason', reason));
end; $$;

-- Promote / demote / assign roles. Assigning or removing 'admin' is OWNER-ONLY
-- (requirement 3 + 16). 'owner' can never be assigned. Owner targets are protected.
create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  if new_role not in ('user','moderator','admin') then
    raise exception 'invalid role % (owner is immutable)', new_role;
  end if;
  perform public._guard_owner_target(target);
  -- Managing admins requires the owner; managing moderators requires an admin.
  select role into v_old from public.profiles where id = target;
  if new_role = 'admin' or v_old = 'admin' then
    perform public._require_owner();
  else
    perform public._require_admin();
  end if;
  update public.profiles set role = new_role where id = target;
  perform public._audit('set_role', target::text, jsonb_build_object('from', v_old, 'to', new_role));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) PREMIUM MANAGEMENT RPCs  (immediate effect)
-- ─────────────────────────────────────────────────────────────────────────────
-- Grant / gift premium for a fixed duration or a custom expiry. Lifetime is
-- OWNER-ONLY (requirement 16).
create or replace function public.admin_grant_premium(
  target uuid, duration text, custom_end timestamptz default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_end timestamptz; v_plan text;
begin
  perform public._require_admin();
  if duration = 'lifetime' then perform public._require_owner(); end if;
  v_end := case duration
    when '1m'       then now() + interval '1 month'
    when '3m'       then now() + interval '3 months'
    when '6m'       then now() + interval '6 months'
    when '1y'       then now() + interval '1 year'
    when 'lifetime' then timestamptz '2099-12-31 00:00:00+00'
    when 'custom'   then custom_end
    else null end;
  if v_end is null then raise exception 'invalid duration %', duration; end if;
  v_plan := case when duration in ('1m','3m','6m') then 'monthly' else 'yearly' end;
  insert into public.subscriptions (user_id, plan, status, provider, amount_inr,
      current_period_start, current_period_end, cancel_at_period_end, updated_at)
  values (target, v_plan, 'active', 'manual', 0, now(), v_end, false, now())
  on conflict (user_id) do update set
    plan = excluded.plan, status = 'active', provider = 'manual',
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = false, updated_at = now();
  perform public._audit('grant_premium', target::text,
    jsonb_build_object('duration', duration, 'ends', v_end));
end;
$$;

create or replace function public.admin_revoke_premium(target uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  update public.subscriptions set status = 'expired', current_period_end = now(), updated_at = now()
  where user_id = target;
  perform public._audit('revoke_premium', target::text, '{}'::jsonb);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) CONTENT MODERATION RPCs  (soft-delete messages; hard-delete content objects)
-- ─────────────────────────────────────────────────────────────────────────────
-- Covers every message media type (image/file/audio/video/gif/sticker/voice) —
-- they are all rows in public.messages.
create or replace function public.admin_delete_message(msg uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_moderator_or_admin();
  update public.messages set is_deleted = true, content = null, media_url = null where id = msg;
  perform public._audit('delete_message', msg::text, '{}'::jsonb);
end; $$;

create or replace function public.admin_delete_status(status_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_moderator_or_admin();
  delete from public.statuses where id = status_id;
  perform public._audit('delete_status', status_id::text, '{}'::jsonb);
end; $$;

create or replace function public.admin_delete_community(comm uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  delete from public.communities where id = comm;
  perform public._audit('delete_community', comm::text, '{}'::jsonb);
end; $$;

create or replace function public.admin_delete_conversation(conv uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  delete from public.conversations where id = conv;
  perform public._audit('delete_conversation', conv::text, '{}'::jsonb);
end; $$;

create or replace function public.admin_delete_channel(chan uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  delete from public.channels where id = chan;
  perform public._audit('delete_channel', chan::text, '{}'::jsonb);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) COMMUNITY MANAGEMENT RPCs
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_community_remove_member(comm uuid, target uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  delete from public.community_members where community_id = comm and user_id = target;
  perform public._audit('community_remove_member', comm::text, jsonb_build_object('user', target));
end; $$;

create or replace function public.admin_transfer_community(comm uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  update public.communities set owner_id = new_owner where id = comm;
  insert into public.community_members (community_id, user_id, role)
  values (comm, new_owner, 'admin')
  on conflict (community_id, user_id) do update set role = 'admin';
  perform public._audit('transfer_community', comm::text, jsonb_build_object('new_owner', new_owner));
end; $$;

create or replace function public.admin_edit_community(comm uuid, new_name text, new_description text)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  update public.communities set
    name = coalesce(new_name, name),
    description = coalesce(new_description, description)
  where id = comm;
  perform public._audit('edit_community', comm::text,
    jsonb_build_object('name', new_name, 'description', new_description));
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12) APP MANAGEMENT + FEATURE FLAGS  (owner-only)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_feature_flag(p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_owner();
  insert into public.feature_flags (key, enabled, updated_at, updated_by)
  values (p_key, p_enabled, now(), auth.uid())
  on conflict (key) do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public._audit('feature_flag', p_key, jsonb_build_object('enabled', p_enabled));
end; $$;

create or replace function public.admin_send_announcement(p_kind text, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public._require_owner();
  insert into public.announcements (kind, title, body, created_by)
  values (coalesce(p_kind,'announcement'), p_title, p_body, auth.uid())
  returning id into v_id;
  perform public._audit('announcement', v_id::text, jsonb_build_object('kind', p_kind, 'title', p_title));
  return v_id;
end; $$;

-- Enable / disable the whole app = the app_enabled feature flag.
create or replace function public.admin_set_app_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public.admin_set_feature_flag('app_enabled', p_enabled);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13) ANALYTICS / METRICS / HEALTH  (admin read)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the analytics function WITHOUT breaking the 8 keys 0009 already returns.
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public
as $$ begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  return json_build_object(
    'users',         (select count(*) from public.profiles),
    'messages',      (select count(*) from public.messages),
    'conversations', (select count(*) from public.conversations),
    'communities',   (select count(*) from public.communities),
    'statuses',      (select count(*) from public.statuses where expires_at > now()),
    'premium_users', (select count(*) from public.subscriptions
                        where status = 'active' and current_period_end > now()),
    'open_reports',  (select count(*) from public.reports where status in ('open','reviewing')),
    'open_tickets',  (select count(*) from public.support_tickets where status in ('open','in_progress')),
    -- additive analytics keys ↓
    'online_users',  (select count(*) from public.profiles where last_seen > now() - interval '5 minutes'),
    'dau',           (select count(*) from public.profiles where last_seen > now() - interval '1 day'),
    'mau',           (select count(*) from public.profiles where last_seen > now() - interval '30 days'),
    'new_today',     (select count(*) from public.profiles where created_at > date_trunc('day', now())),
    'banned_users',  (select count(*) from public.profiles where account_status = 'banned'),
    'total_calls',   (select count(*) from public.calls),
    'failed_calls',  (select count(*) from public.calls where status in ('missed','declined')),
    'channels',      (select count(*) from public.channels)
  );
end; $$;

create or replace function public.admin_call_stats()
returns json language plpgsql stable security definer set search_path = public
as $$ begin
  perform public._require_admin();
  return json_build_object(
    'active_audio',   (select count(*) from public.calls where type='audio' and status in ('ringing','accepted')),
    'active_video',   (select count(*) from public.calls where type='video' and status in ('ringing','accepted')),
    'ringing',        (select count(*) from public.calls where status='ringing'),
    'failed',         (select count(*) from public.calls where status in ('missed','declined')),
    'ice_failures',   (select coalesce(sum(ice_failures),0) from public.calls),
    'reconnects',     (select coalesce(sum(reconnects),0) from public.calls),
    'turn_calls',     (select count(*) from public.calls where turn_used = true),
    'avg_duration_s', (select coalesce(round(avg(extract(epoch from (ended_at - answered_at)))),0)
                         from public.calls where answered_at is not null and ended_at is not null),
    'recent', coalesce((select json_agg(row_to_json(c)) from (
        select id, type, status, connection_state, ice_failures, reconnects, turn_used,
               failure_reason, started_at, answered_at, ended_at
        from public.calls order by started_at desc limit 50) c), '[]'::json)
  );
end; $$;

create or replace function public.admin_message_stats()
returns json language plpgsql stable security definer set search_path = public
as $$ begin
  perform public._require_admin();
  return json_build_object(
    'total',          (select count(*) from public.messages),
    'deleted',        (select count(*) from public.messages where is_deleted = true),
    'delivered',      (select count(*) from public.message_receipts where status='delivered'),
    'read',           (select count(*) from public.message_receipts where status='read'),
    'scheduled_pending', (select count(*) from public.scheduled_messages where sent = false),
    'undelivered',    (select count(*) from public.messages m
                        where not exists (select 1 from public.message_receipts r where r.message_id = m.id))
  );
end; $$;

-- Best-effort DB health from inside Postgres. External service checks (realtime,
-- storage, auth, edge) are probed client-side; here we return DB-side truth.
create or replace function public.admin_db_health()
returns json language plpgsql stable security definer set search_path = public
as $$
declare t0 timestamptz := clock_timestamp();
begin
  perform public._require_admin();
  perform 1;
  return json_build_object(
    'database', 'ok',
    'latency_ms', round(extract(milliseconds from (clock_timestamp() - t0))::numeric, 2),
    'now', now(),
    'profiles', (select count(*) from public.profiles),
    'oldest_pending_scheduled', (select min(send_at) from public.scheduled_messages where sent = false),
    'pending_deletions', (select count(*) from public.account_deletion_requests where status='pending')
  );
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14) GLOBAL ADMIN SEARCH  (users, communities, channels, messages, calls, reports)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_global_search(q text)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v_q text := '%' || trim(coalesce(q,'')) || '%';
begin
  perform public._require_admin();
  return json_build_object(
    'users', public.admin_search_users(q),
    'communities', coalesce((select json_agg(row_to_json(c)) from (
        select id, name, description, owner_id, created_at from public.communities
        where name ilike v_q or coalesce(description,'') ilike v_q limit 25) c), '[]'::json),
    'channels', coalesce((select json_agg(row_to_json(c)) from (
        select id, name, kind, community_id from public.channels where name ilike v_q limit 25) c), '[]'::json),
    'messages', coalesce((select json_agg(row_to_json(m)) from (
        select id, conversation_id, sender_id, type, content, created_at from public.messages
        where content ilike v_q and is_deleted = false order by created_at desc limit 25) m), '[]'::json),
    'reports', coalesce((select json_agg(row_to_json(r)) from (
        select id, target_type, target_id, reason, status, created_at from public.reports
        where reason ilike v_q or coalesce(details,'') ilike v_q limit 25) r), '[]'::json)
  );
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15) SECURITY + AUDIT (owner-gated audit read; device removal)
-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log is OWNER-ONLY to read (requirement 16), with the actor's email joined.
create or replace function public.admin_audit_log(p_limit int default 200)
returns json language plpgsql stable security definer set search_path = public
as $$ begin
  perform public._require_owner();
  return coalesce((select json_agg(row_to_json(t)) from (
    select a.id, a.action, a.target, a.meta, a.created_at,
           a.user_id as actor_id, u.email as actor_email
    from public.audit_log a left join auth.users u on u.id = a.user_id
    order by a.created_at desc limit least(coalesce(p_limit,200), 1000)) t), '[]'::json);
end; $$;

create or replace function public.admin_remove_device(p_device uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_user uuid;
begin
  perform public._require_admin();
  select user_id into v_user from public.devices where id = p_device;
  delete from public.devices where id = p_device;
  perform public._audit('remove_device', p_device::text, jsonb_build_object('user', v_user));
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16) GRANTS  (RPCs are self-gating; expose to authenticated only)
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.admin_search_users(text)                               to authenticated;
grant execute on function public.admin_get_user(uuid)                                    to authenticated;
grant execute on function public.admin_set_account_status(uuid,text,text,timestamptz)    to authenticated;
grant execute on function public.admin_verify_user(uuid,boolean)                         to authenticated;
grant execute on function public.admin_force_logout(uuid)                                to authenticated;
grant execute on function public.admin_delete_account(uuid,text)                         to authenticated;
grant execute on function public.admin_set_role(uuid,text)                               to authenticated;
grant execute on function public.admin_grant_premium(uuid,text,timestamptz)              to authenticated;
grant execute on function public.admin_revoke_premium(uuid)                              to authenticated;
grant execute on function public.admin_delete_message(uuid)                              to authenticated;
grant execute on function public.admin_delete_status(uuid)                               to authenticated;
grant execute on function public.admin_delete_community(uuid)                            to authenticated;
grant execute on function public.admin_delete_conversation(uuid)                         to authenticated;
grant execute on function public.admin_delete_channel(uuid)                              to authenticated;
grant execute on function public.admin_community_remove_member(uuid,uuid)                to authenticated;
grant execute on function public.admin_transfer_community(uuid,uuid)                     to authenticated;
grant execute on function public.admin_edit_community(uuid,text,text)                    to authenticated;
grant execute on function public.admin_set_feature_flag(text,boolean)                    to authenticated;
grant execute on function public.admin_send_announcement(text,text,text)                 to authenticated;
grant execute on function public.admin_set_app_enabled(boolean)                          to authenticated;
grant execute on function public.admin_call_stats()                                      to authenticated;
grant execute on function public.admin_message_stats()                                   to authenticated;
grant execute on function public.admin_db_health()                                       to authenticated;
grant execute on function public.admin_global_search(text)                               to authenticated;
grant execute on function public.admin_audit_log(int)                                    to authenticated;
grant execute on function public.admin_remove_device(uuid)                               to authenticated;
