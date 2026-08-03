-- 0045_crash_reports_and_ops.sql
-- P0: durable crash breadcrumb sink for production (no third-party SDK required).
-- Edge Function `crash-report` inserts rows with the service role.

create table if not exists public.crash_reports (
  id            bigserial primary key,
  user_id       uuid references auth.users(id) on delete set null,
  platform      text,
  platform_ver  text,
  app_version   text,
  label         text not null default 'unknown',
  message       text,
  stack         text,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_crash_reports_created
  on public.crash_reports (created_at desc);

create index if not exists idx_crash_reports_user
  on public.crash_reports (user_id, created_at desc)
  where user_id is not null;

alter table public.crash_reports enable row level security;

-- Clients never read/write directly — Edge Function uses service role.
drop policy if exists "no client access crash_reports" on public.crash_reports;
-- Intentionally zero policies for authenticated/anon → deny all client access.

grant all on public.crash_reports to service_role;
grant usage, select on sequence public.crash_reports_id_seq to service_role;

-- Optional: purge rows older than 30 days (call from cron / ops).
create or replace function public.purge_old_crash_reports()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.crash_reports
  where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.purge_old_crash_reports() to service_role;
