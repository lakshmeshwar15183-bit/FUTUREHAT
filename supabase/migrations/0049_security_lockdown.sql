-- 0049_security_lockdown.sql
-- P0 security: free-premium RPC, system-message forgery via UPDATE, push/outbox RPC grants,
-- FCM token reassignment, post_system_message membership.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_activate_subscription — service_role ONLY (fix inverted gate)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_activate_subscription(
  p_user_id uuid,
  p_plan text,
  p_provider text,
  p_provider_subscription_id text default null,
  p_provider_customer_id text default null,
  p_amount_inr integer default 0,
  p_period_days integer default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  start_at timestamptz := now();
  end_at   timestamptz := now() + make_interval(days => greatest(coalesce(p_period_days, 30), 1));
begin
  -- Strict: only service_role / postgres. End-user JWTs (auth.uid() set) always fail.
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  if p_user_id is null then
    raise exception 'user required';
  end if;
  if p_plan is null or p_plan not in ('monthly', 'yearly') then
    raise exception 'invalid plan';
  end if;

  -- Idempotent payment proof: same provider payment id must not re-extend forever.
  if coalesce(trim(p_provider_subscription_id), '') <> '' then
    if exists (
      select 1 from public.subscriptions s
      where s.provider_subscription_id = p_provider_subscription_id
        and s.user_id is distinct from p_user_id
    ) then
      raise exception 'payment already bound to another account';
    end if;
    if exists (
      select 1 from public.subscriptions s
      where s.user_id = p_user_id
        and s.provider_subscription_id = p_provider_subscription_id
        and s.status = 'active'
        and s.current_period_end > now()
    ) then
      -- Already activated for this payment while still active — no-op success.
      return;
    end if;
  end if;

  insert into public.subscriptions as s (
    user_id, plan, status, provider, provider_subscription_id, provider_customer_id,
    amount_inr, current_period_start, current_period_end, cancel_at_period_end, updated_at
  ) values (
    p_user_id, p_plan, 'active', coalesce(p_provider, 'manual'),
    p_provider_subscription_id, p_provider_customer_id,
    coalesce(p_amount_inr, 0), start_at, end_at, false, start_at
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    provider = excluded.provider,
    provider_subscription_id = excluded.provider_subscription_id,
    provider_customer_id = excluded.provider_customer_id,
    amount_inr = excluded.amount_inr,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = false,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.admin_activate_subscription(uuid, text, text, text, text, integer, integer)
  from public, anon, authenticated;
-- service_role bypasses REVOKE via superuser path; explicit grant for clarity:
grant execute on function public.admin_activate_subscription(uuid, text, text, text, text, integer, integer)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) System messages: membership + revoke client EXECUTE; freeze type on UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Service role / postgres may post without membership; end users must be members.
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
-- Group RPCs run as definer and call this internally; keep execute for authenticated
-- only if those RPCs are SECURITY DEFINER and already membership-checked.
-- Prefer service + definer chain: grant only to postgres/service.
grant execute on function public.post_system_message(uuid, text) to service_role;

-- Freeze type / conversation / sender on client UPDATE (blocks text→system forgery).
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.type is distinct from new.type then
    raise exception 'message type cannot be changed';
  end if;
  if old.sender_id is distinct from new.sender_id then
    raise exception 'sender cannot be changed';
  end if;
  if old.conversation_id is distinct from new.conversation_id then
    raise exception 'conversation cannot be changed';
  end if;
  if new.type = 'system'
     and current_setting('app.allow_system_msg', true) is distinct from 'on' then
    -- Even content edits of system rows: only allow if already system and sender matches.
    if old.content is distinct from new.content and auth.uid() is not null then
      raise exception 'system messages cannot be edited by clients';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Push pipeline RPCs — service_role only (stop client spam / suppress)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- enqueue_push
  if exists (select 1 from pg_proc where proname = 'enqueue_push') then
    execute 'revoke all on function public.enqueue_push(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated';
    execute 'grant execute on function public.enqueue_push(uuid, text, text, text, jsonb, uuid) to service_role';
  end if;
exception when others then
  raise notice 'enqueue_push revoke: %', sqlerrm;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
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
  -- authenticated still needs claim_push_dedupe / mark for Edge path? No — edge uses service role.
  -- Client sendPush uses Edge Function with user JWT; Edge uses service role for admin client.
end $$;

-- Re-grant claim_push_dedupe + mark_push_dedupe_delivered to authenticated only if
-- Edge Function uses user JWT supabase client for those RPCs. Looking at push/index.ts:
-- it uses SERVICE role admin client for claim_push_dedupe. So service_role only is correct.
-- But wait - client path uses createClient with SERVICE for admin. Good.

-- Edge also uses admin.rpc for mark_push_dedupe_delivered with service. Good.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) FCM token hijack: do not steal another user's token on conflict
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.register_push_token(
  p_token text,
  p_platform text default 'android'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_token), '') = '' then return; end if;

  insert into public.device_push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform, 'android'), now())
  on conflict (token) do update
    set platform = excluded.platform,
        updated_at = now(),
        -- Only reassign if already ours or unowned (should not happen)
        user_id = case
          when public.device_push_tokens.user_id = auth.uid() then auth.uid()
          else public.device_push_tokens.user_id
        end
  where public.device_push_tokens.user_id = auth.uid()
     or public.device_push_tokens.user_id is null;

  -- If token belongs to someone else, insert fails silently for attacker:
  -- delete own old tokens for this platform optional; refuse reassignment.
  if not exists (
    select 1 from public.device_push_tokens t
    where t.token = p_token and t.user_id = auth.uid()
  ) then
    -- Token owned by another account — do not hijack.
    return;
  end if;
end;
$$;

-- Drop client-facing token harvest if function exists
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'recipient_push_tokens'
  ) then
    execute (
      select string_agg(
        format('revoke all on function %s from public, anon, authenticated', p.oid::regprocedure),
        '; '
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'recipient_push_tokens'
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) is_admin / is_premium probe — only self
-- ─────────────────────────────────────────────────────────────────────────────
-- profiles has `role` (admin/owner/moderator/user) — no is_admin boolean column.
-- Preserve 0013 semantics (owner OR role=admin) while blocking cross-user probes
-- from authenticated clients. RLS uses is_admin(auth.uid()) so self-check is enough.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when auth.uid() is null and auth.role() is distinct from 'service_role' then false
    when uid is distinct from auth.uid()
         and auth.role() is distinct from 'service_role'
         and current_user not in ('postgres', 'supabase_admin') then false
    else (
      public.is_owner(uid)
      or exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin')
    )
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Unique index for payment idempotency (soft — nullable provider id)
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists idx_subscriptions_provider_payment
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null
    and length(trim(provider_subscription_id)) > 0;
