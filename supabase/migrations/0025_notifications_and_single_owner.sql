-- 0025_notifications_and_single_owner.sql — Push tokens + single permanent owner.
-- ============================================================================
-- ADDITIVE + idempotent. Two concerns:
--   1) FCM device push tokens: a per-user token registry the push Edge Function
--      fans out to (killed-state delivery). Own-rows RLS; a member-gated helper
--      returns the OTHER members' tokens for a conversation.
--   2) Single permanent owner/admin: the Owner is the immutable developer
--      allowlist (is_developer, 0005) and is the ONLY admin. This re-creates
--      admin_set_role so 'admin' can NEVER be assigned from the app — only
--      'user'/'moderator'. The Owner keeps every power (is_admin() = is_owner()
--      OR role='admin'; no one can reach role='admin' anymore). Moderator
--      assign/remove (0023) is unchanged.
-- Apply after 0024. Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) DEVICE PUSH TOKENS  (FCM registration tokens; own-rows only)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.device_push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null default 'android' check (platform in ('android','ios','web')),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on public.device_push_tokens(user_id);
alter table public.device_push_tokens enable row level security;

drop policy if exists "manage own push tokens" on public.device_push_tokens;
create policy "read own push tokens" on public.device_push_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own push tokens" on public.device_push_tokens
  for insert to authenticated with check (auth.uid() = user_id);
create policy "update own push tokens" on public.device_push_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own push tokens" on public.device_push_tokens
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.device_push_tokens to authenticated;

-- Register / refresh this device's FCM token (idempotent on the token PK).
create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_token),'') = '' then return; end if;
  insert into public.device_push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform,'android'), now())
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end; $$;

create or replace function public.remove_push_token(p_token text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.device_push_tokens where token = p_token and user_id = auth.uid();
end; $$;

-- Tokens of the OTHER members of a conversation the caller belongs to — used by
-- the push Edge Function to fan a notification out to recipients. Member-gated.
create or replace function public.recipient_push_tokens(p_conversation uuid)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_conversation) then raise exception 'not a member'; end if;
  return coalesce((
    select json_agg(json_build_object('token', t.token, 'platform', t.platform, 'user_id', t.user_id))
    from public.device_push_tokens t
    join public.conversation_participants cp
      on cp.user_id = t.user_id and cp.conversation_id = p_conversation
    where t.user_id <> v_me
  ), '[]'::json);
end; $$;

grant execute on function public.register_push_token(text, text)   to authenticated;
grant execute on function public.remove_push_token(text)           to authenticated;
grant execute on function public.recipient_push_tokens(uuid)       to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) SINGLE PERMANENT OWNER/ADMIN — forbid assigning 'admin' from the app
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-creates admin_set_role (0013). Now only 'user' / 'moderator' are assignable.
-- 'admin' (and 'owner') can NEVER be granted or revoked via the client. The Owner
-- remains admin through is_owner() (the developer allowlist), independent of the
-- profiles.role column, so the single-owner model is enforced in the database.
create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  -- Admin is permanent (the developer/owner allowlist). It cannot be assigned,
  -- transferred, or revoked through the app.
  if new_role not in ('user','moderator') then
    raise exception 'admin role is permanent and cannot be assigned';
  end if;
  perform public._guard_owner_target(target);
  perform public._require_admin();     -- only the Owner-tier can manage roles
  select role into v_old from public.profiles where id = target;
  -- Never downgrade an existing admin row via this path either.
  if v_old = 'admin' then
    raise exception 'admin role is permanent and cannot be changed';
  end if;
  update public.profiles set role = new_role where id = target;
  perform public._audit('set_role', target::text, jsonb_build_object('from', v_old, 'to', new_role));
end;
$$;

grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) REALTIME  (push tokens don't need realtime; nothing to publish here)
-- ─────────────────────────────────────────────────────────────────────────────
