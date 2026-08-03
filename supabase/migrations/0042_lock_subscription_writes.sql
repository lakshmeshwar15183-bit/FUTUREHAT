-- 0042_lock_subscription_writes.sql
-- CRITICAL: stop free self-grant of Lumixo+ via client RLS.
--
-- Before: any authenticated user could INSERT/UPDATE public.subscriptions
-- and grant themselves status=active (premium bypass — no payment).
--
-- After:
--   • authenticated users may only SELECT their own row
--   • cancel is a SECURITY DEFINER RPC that only sets cancel_at_period_end
--   • activate/renew is service-role only (payment webhook / admin / Edge Function)
--   • developer/admin override paths are unchanged (is_premium already security definer)

-- ── Revoke free client writes ──────────────────────────────────────────────────
drop policy if exists "insert own subscription" on public.subscriptions;
drop policy if exists "update own subscription" on public.subscriptions;

-- Keep select policies from 0003 (read own + read premium flags for badges).

-- ── Cancel renewal (user-facing) ───────────────────────────────────────────────
create or replace function public.cancel_my_subscription()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.subscriptions
  set
    cancel_at_period_end = true,
    updated_at = now()
  where user_id = auth.uid()
    and status = 'active';
end;
$$;

revoke all on function public.cancel_my_subscription() from public;
grant execute on function public.cancel_my_subscription() to authenticated;

-- ── Service-only activation (payment provider / admin tooling) ─────────────────
-- Call with service_role after payment verification. Not granted to authenticated.
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
  -- Only callable with elevated privilege (service role bypasses RLS; we still
  -- refuse if someone somehow grants execute to authenticated without service).
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    -- Allow when JWT is missing (service key client often has no user JWT) but
    -- request is not an end-user JWT. End users have auth.uid() set.
    if auth.uid() is not null then
      raise exception 'forbidden';
    end if;
  end if;

  if p_user_id is null then
    raise exception 'user required';
  end if;
  if p_plan is null or p_plan not in ('monthly', 'yearly') then
    raise exception 'invalid plan';
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

revoke all on function public.admin_activate_subscription(uuid, text, text, text, text, integer, integer) from public;
-- Not granted to authenticated / anon — only service_role / postgres.
