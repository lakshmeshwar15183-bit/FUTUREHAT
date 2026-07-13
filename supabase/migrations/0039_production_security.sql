-- 0039_production_security.sql
-- Production readiness: close CRITICAL regressions and add defense-in-depth.
--
-- CRITICAL fixes:
--   1) storage.objects policies from 0034 were world-authenticated (any user
--      could read/write ANY media). Restore membership-scoped policies (0015).
--   2) invites SELECT USING (true) let any user enumerate invite tokens and
--      join private groups. Restrict listing; resolve via SECURITY DEFINER RPC.
--
-- HIGH / MEDIUM:
--   3) Rate limiting table + check_rate_limit() for spam/brute paths.
--   4) Message content length cap (server-side).
--   5) Group member add cap.
--   6) public_profiles view (no phone / moderation columns) for discovery.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) MEDIA BUCKET — restore membership-scoped RLS (CRITICAL)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "auth_upload_media" on storage.objects;
drop policy if exists "auth_read_media" on storage.objects;
drop policy if exists "media auth read" on storage.objects;
drop policy if exists "media auth write" on storage.objects;
drop policy if exists "media auth update" on storage.objects;
drop policy if exists "media auth delete" on storage.objects;

-- Objects live at `<conversation_id>/<file>`. Gate on membership.
create policy "media auth read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

create policy "media auth write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

-- Allow replace/delete only for members (sender cleanup, re-upload).
create policy "media auth update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

create policy "media auth delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and public.is_member(
      case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
           then ((storage.foldername(name))[1])::uuid end)
  );

-- Ensure media bucket is private
update storage.buckets set public = false where id = 'media';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) INVITES — stop token enumeration (CRITICAL)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "read invites" on public.invites;
drop policy if exists "read own target invites" on public.invites;

-- Admins of the target may list their invites; nobody else can SELECT freely.
create policy "read own target invites" on public.invites
  for select to authenticated
  using (
    (target_type = 'conversation' and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = target_id
        and p.user_id = auth.uid()
        and p.role in ('admin', 'super_admin')
    ))
    or (target_type = 'community' and public.is_community_admin(target_id))
    or created_by = auth.uid()
  );

-- Resolve a single invite by opaque token (SECURITY DEFINER, no token leak).
create or replace function public.get_invite_preview(p_token text)
returns table (
  target_type text,
  target_id uuid,
  expires_at timestamptz,
  revoked boolean,
  valid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or length(trim(p_token)) < 8 then
    raise exception 'invalid invite';
  end if;

  select * into inv from public.invites where token = trim(p_token);
  if inv.token is null then
    return query select null::text, null::uuid, null::timestamptz, true, false;
    return;
  end if;

  return query select
    inv.target_type,
    inv.target_id,
    inv.expires_at,
    inv.revoked,
    (
      not inv.revoked
      and (inv.expires_at is null or inv.expires_at > now())
      and (inv.max_uses is null or inv.use_count < inv.max_uses)
    );
end;
$$;

grant execute on function public.get_invite_preview(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RATE LIMITING (HIGH) — simple sliding window per user+action
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null,
  window_start timestamptz not null default date_trunc('minute', now()),
  count      int not null default 0,
  primary key (user_id, action, window_start)
);

create index if not exists idx_rate_limits_cleanup
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No client policies — only SECURITY DEFINER functions touch this.

create or replace function public.check_rate_limit(
  p_action text,
  p_max_per_minute int default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  win timestamptz := date_trunc('minute', now());
  cnt int;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if p_max_per_minute < 1 then
    p_max_per_minute := 1;
  end if;

  insert into public.rate_limits (user_id, action, window_start, count)
  values (me, p_action, win, 1)
  on conflict (user_id, action, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into cnt;

  if cnt > p_max_per_minute then
    return false;
  end if;
  return true;
end;
$$;

grant execute on function public.check_rate_limit(text, int) to authenticated;

-- Opportunistic cleanup of old windows (best-effort, called from rate check occasionally)
create or replace function public.purge_old_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits where window_start < now() - interval '2 hours';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) MESSAGE CONTENT CAP + RATE LIMIT ON SEND (MEDIUM)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cap text body (WhatsApp-scale ~65k; we use 16k for safety/perf).
  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  -- System messages skip rate limit (posted by DEFINER RPCs).
  if new.type is distinct from 'system' and auth.uid() is not null then
    if not public.check_rate_limit('send_message', 120) then
      raise exception 'rate limit exceeded';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_message_insert on public.messages;
create trigger trg_guard_message_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) GROUP CREATE / ADD MEMBER LIMITS (MEDIUM)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_group_conversation(
  p_name        text,
  p_member_ids  uuid[],
  p_avatar_url  text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  me   uuid := auth.uid();
  pid  uuid;
  creator_name text;
  member_names text := '';
  n int := 0;
  total int := 0;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.check_rate_limit('create_group', 10) then
    raise exception 'rate limit exceeded';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'group name is required';
  end if;
  if length(trim(p_name)) > 100 then
    raise exception 'group name too long';
  end if;
  if p_description is not null and length(p_description) > 500 then
    raise exception 'description too long';
  end if;

  if p_member_ids is not null then
    total := coalesce(array_length(p_member_ids, 1), 0);
    if total > 256 then
      raise exception 'too many members (max 256)';
    end if;
  end if;

  insert into public.conversations (type, name, avatar_url, description, created_by)
  values ('group', trim(p_name), p_avatar_url, nullif(trim(coalesce(p_description, '')), ''), me)
  returning id into conv;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (conv, me, 'super_admin');

  if p_member_ids is not null then
    foreach pid in array p_member_ids loop
      if pid is distinct from me then
        insert into public.conversation_participants (conversation_id, user_id, role)
        values (conv, pid, 'member')
        on conflict (conversation_id, user_id) do nothing;
        n := n + 1;
        if n <= 3 then
          member_names := member_names
            || case when member_names = '' then '' else ', ' end
            || public._profile_label(pid);
        end if;
      end if;
    end loop;
  end if;

  creator_name := public._profile_label(me);
  if n = 0 then
    perform public.post_system_message(conv, creator_name || ' created this group');
  elsif n <= 3 then
    perform public.post_system_message(
      conv, creator_name || ' created this group and added ' || member_names);
  else
    perform public.post_system_message(
      conv,
      creator_name || ' created this group and added ' || member_names || ' and '
        || (n - 3)::text || ' others');
  end if;

  return conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[], text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) SAFE PROFILE DISCOVERY VIEW (no phone / moderation columns)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.public_profiles
with (security_invoker = true)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) REPORT / SUPPORT RATE LIMITS (via helper; clients should call check_rate_limit)
-- ─────────────────────────────────────────────────────────────────────────────
-- Soft cleanup job entry point for authenticated (admin paths can call it).
grant execute on function public.purge_old_rate_limits() to authenticated;
