-- 0009_admin.sql — Admin moderation & analytics surface.
-- ============================================================================
-- Gives admins (is_admin = developer allowlist, see 0005) read access to the
-- full moderation queue (reports + support tickets) and the ability to update
-- their status, plus a SECURITY DEFINER stats function for the dashboard.
--
-- SECURITY
--   * Admin policies are ADDED alongside the existing self-only policies. Postgres
--     ORs multiple permissive SELECT policies, so a normal user still sees only
--     their own rows; an admin additionally sees everyone's.
--   * admin_stats() is SECURITY DEFINER but refuses to run for non-admins, so the
--     global counts (messages/conversations are otherwise member-gated) never leak.
--   * No client-writable admin flag exists; is_admin() derives from the protected
--     developer_accounts allowlist.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ── Reports: admins can read all & update status ──────────────────────────────
drop policy if exists "admin read reports" on public.reports;
create policy "admin read reports" on public.reports
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists "admin update reports" on public.reports;
create policy "admin update reports" on public.reports
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── Support tickets: admins can read all & update status ──────────────────────
drop policy if exists "admin read tickets" on public.support_tickets;
create policy "admin read tickets" on public.support_tickets
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists "admin update tickets" on public.support_tickets;
create policy "admin update tickets" on public.support_tickets
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── Dashboard analytics (admin-only, global counts) ───────────────────────────
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  return json_build_object(
    'users',         (select count(*) from public.profiles),
    'messages',      (select count(*) from public.messages),
    'conversations', (select count(*) from public.conversations),
    'communities',   (select count(*) from public.communities),
    'statuses',      (select count(*) from public.statuses where expires_at > now()),
    'premium_users', (select count(*) from public.subscriptions
                        where status = 'active' and current_period_end > now()),
    'open_reports',  (select count(*) from public.reports
                        where status in ('open','reviewing')),
    'open_tickets',  (select count(*) from public.support_tickets
                        where status in ('open','in_progress'))
  );
end;
$$;

grant execute on function public.admin_stats() to authenticated;
