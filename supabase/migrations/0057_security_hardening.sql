-- 0057_security_hardening.sql
-- Production security pass (2026-07):
--   1) Subscriptions: stop leaking billing fields of all premium users
--   2) premium_users view: badge-safe list (user_id only) without invoker RLS trap
--   3) Rate-limit cleanup not callable by clients
--   4) AI rate-limit action key documented (enforced in edge + optional RPC)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) SUBSCRIPTIONS — own row only for authenticated clients
-- ═══════════════════════════════════════════════════════════════════════════
-- Was: "read premium flags" allowed SELECT on every active subscription, which
-- exposed amount_inr, provider ids, periods for all Lumixo+ users (privacy leak).
-- Badges use public.premium_users (user_id only) instead.

drop policy if exists "read premium flags" on public.subscriptions;
drop policy if exists "read own subscription" on public.subscriptions;
drop policy if exists "users read own subscription" on public.subscriptions;

create policy "users read own subscription"
  on public.subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

-- No client INSERT/UPDATE/DELETE on subscriptions (activation is service_role only).
drop policy if exists "users cannot write subscriptions" on public.subscriptions;
-- Explicit deny via absence of write policies + grants.

revoke insert, update, delete on public.subscriptions from authenticated, anon;
grant select on public.subscriptions to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) premium_users — user_id only, security_invoker off so badges still work
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view public.premium_users
with (security_invoker = false)
as
  select s.user_id
  from public.subscriptions s
  where s.status = 'active'
    and s.current_period_end > now();

grant select on public.premium_users to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RATE LIMIT MAINTENANCE — not a client DoS vector
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on function public.purge_old_rate_limits() from public, anon, authenticated;
-- service_role / postgres retain access via ownership

-- Opportunistic cleanup from check_rate_limit (1% of calls) so windows don't grow forever.
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
  -- Cap action key length to avoid index abuse
  if p_action is null or length(p_action) < 1 or length(p_action) > 64 then
    raise exception 'invalid action';
  end if;

  insert into public.rate_limits (user_id, action, window_start, count)
  values (me, p_action, win, 1)
  on conflict (user_id, action, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into cnt;

  -- ~1% opportunistic purge (best-effort)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 hours';
  end if;

  if cnt > p_max_per_minute then
    return false;
  end if;
  return true;
end;
$$;

grant execute on function public.check_rate_limit(text, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) AI rate limit is enforced in edge function via check_rate_limit('ai', N)
--    Documented action key: 'ai' → 20/min per user (premium only at edge).
-- ═══════════════════════════════════════════════════════════════════════════

comment on function public.check_rate_limit(text, int) is
  'Per-user per-minute rate limit. Used by message send, reports, support, and AI edge.';
