-- 0051_p0_security_seal.sql
-- Absolute seal for the six P0s (idempotent / safe re-apply):
--   1) System message UPDATE forgery
--   2) Push RPC client abuse
--   3) FCM token hijack
--   4) Profiles phone enumeration
-- (AppLock + XSS are client-side; verified separately.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) SYSTEM MESSAGES — immutable for clients (INSERT + UPDATE)
-- ═══════════════════════════════════════════════════════════════════════════

-- INSERT already blocked by guard_message_insert (0040/0044). Reassert.
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_peer uuid;
begin
  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  -- Clients cannot create system rows. Only SECURITY DEFINER paths that set
  -- app.allow_system_msg=on (post_system_message) may insert type=system.
  if new.type = 'system' then
    if current_setting('app.allow_system_msg', true) is distinct from 'on' then
      raise exception 'system messages cannot be inserted by clients';
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    if not public.check_rate_limit('send_message', 120) then
      raise exception 'rate limit exceeded';
    end if;
  end if;

  if auth.uid() is not null and new.sender_id is distinct from auth.uid() then
    raise exception 'sender mismatch';
  end if;

  select c.type into v_type from public.conversations c where c.id = new.conversation_id;
  if v_type = 'direct' and auth.uid() is not null then
    select cp.user_id into v_peer
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.user_id is distinct from auth.uid()
    limit 1;
    if v_peer is not null and public.users_are_blocked(auth.uid(), v_peer) then
      raise exception 'cannot message this user';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_message_insert on public.messages;
create trigger trg_guard_message_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();

-- UPDATE: freeze identity fields; system rows fully immutable for clients.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never allow type promotion (text → system) or demotion / re-typing.
  if old.type is distinct from new.type then
    raise exception 'message type cannot be changed';
  end if;
  if old.sender_id is distinct from new.sender_id then
    raise exception 'sender cannot be changed';
  end if;
  if old.conversation_id is distinct from new.conversation_id then
    raise exception 'conversation cannot be changed';
  end if;

  -- System messages are fully immutable unless the official post path is active.
  -- Blocks content, media, soft-delete, reply, edit timestamp, and media_meta.
  if old.type = 'system'
     and current_setting('app.allow_system_msg', true) is distinct from 'on' then
    if old.content is distinct from new.content
       or old.media_url is distinct from new.media_url
       or old.is_deleted is distinct from new.is_deleted
       or old.reply_to is distinct from new.reply_to
       or old.edited_at is distinct from new.edited_at
       or old.media_meta is distinct from new.media_meta
    then
      raise exception 'system messages are immutable';
    end if;
  end if;

  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_message_update on public.messages;
create trigger trg_guard_message_update
  before update on public.messages
  for each row execute function public.guard_message_update();

-- post_system_message: membership for end users; service_role unrestricted.
create or replace function public.post_system_message(p_conv uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  me  uuid := auth.uid();
  sender uuid;
begin
  if p_text is null or length(trim(p_text)) = 0 then
    return null;
  end if;

  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    if me is null then
      raise exception 'not authenticated';
    end if;
    if not exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = p_conv and cp.user_id = me
    ) then
      raise exception 'not a member';
    end if;
  end if;

  sender := coalesce(me, (select created_by from public.conversations where id = p_conv));
  if sender is null then
    return null;
  end if;
  perform set_config('app.allow_system_msg', 'on', true);
  insert into public.messages (conversation_id, sender_id, type, content)
  values (p_conv, sender, 'system', trim(p_text))
  returning id into mid;
  return mid;
end;
$$;

revoke all on function public.post_system_message(uuid, text) from public, anon, authenticated;
grant execute on function public.post_system_message(uuid, text) to service_role;
-- SECURITY DEFINER group RPCs are owned by postgres/supabase_admin and call this
-- internally; superuser path does not need authenticated EXECUTE.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) PUSH RPCs — service_role ONLY (all overloads)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'enqueue_push',
        'claim_push_outbox',
        'mark_push_delivered',
        'claim_push_dedupe',
        'mark_push_dedupe_delivered',
        'release_push_dedupe',
        'recipient_push_tokens'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) FCM TOKEN HIJACK — never reassign another user's token
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.register_push_token(
  p_token text,
  p_platform text default 'android'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tok text := trim(p_token);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_tok is null or v_tok = '' then
    return;
  end if;
  if length(v_tok) > 512 then
    raise exception 'token too long';
  end if;

  select t.user_id into v_owner
  from public.device_push_tokens t
  where t.token = v_tok
  for update;

  if found then
    -- Owned by someone else → hard refuse (no hijack).
    if v_owner is not null and v_owner is distinct from v_uid then
      return;
    end if;
    -- Own or unowned: refresh platform/ownership to current user.
    update public.device_push_tokens
       set user_id = v_uid,
           platform = coalesce(nullif(trim(p_platform), ''), platform, 'android'),
           updated_at = now()
     where token = v_tok;
    return;
  end if;

  insert into public.device_push_tokens (token, user_id, platform, updated_at)
  values (v_tok, v_uid, coalesce(nullif(trim(p_platform), ''), 'android'), now())
  on conflict (token) do nothing;

  -- Race: another session claimed it as a different user between SELECT and INSERT.
  if not exists (
    select 1 from public.device_push_tokens t
    where t.token = v_tok and t.user_id = v_uid
  ) then
    return; -- not ours; do not steal
  end if;
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) PROFILES — phone / moderation not enumerable by peers
-- ═══════════════════════════════════════════════════════════════════════════

-- Safe discovery view (owner rights so peer lookup works while base RLS is tight).
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

-- Base table: only own row or admin (no world-readable full profiles).
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin(auth.uid())
  );

-- Defense-in-depth: if a future policy widens rows, phone still needs explicit
-- column privilege. Postgres grants are table-level by default; we cannot easily
-- split phone per-row, so RLS own-or-admin is the primary control. Document that
-- clients MUST use public_profiles for peer reads (enforced in shared/api.ts).
