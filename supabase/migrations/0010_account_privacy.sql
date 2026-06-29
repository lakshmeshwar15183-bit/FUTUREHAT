-- 0010_account_privacy.sql — schema for archived chats, richer profiles, account
-- deletion (with recovery window), audit log, and security/login events.
-- Idempotent. Applied during manual checkpoint recovery (not auto-applied).
-- ============================================================================

-- ── Archived conversations (per-user, like pinned/hidden) ─────────────────────
create table if not exists public.archived_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  archived_at     timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.archived_conversations enable row level security;
drop policy if exists "manage own archives" on public.archived_conversations;
create policy "manage own archives" on public.archived_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Richer profile fields (social links) ──────────────────────────────────────
alter table public.profiles add column if not exists links jsonb not null default '[]'::jsonb;

-- ── Account deletion with a recovery period ──────────────────────────────────
-- A request marks the account for deletion after `purge_after`. The user can
-- cancel before then. Actual purge is performed by a privileged job/edge fn.
create table if not exists public.account_deletion_requests (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after  timestamptz not null default (now() + interval '30 days'),
  reason       text,
  status       text not null default 'pending' check (status in ('pending','cancelled','completed'))
);
alter table public.account_deletion_requests enable row level security;
drop policy if exists "manage own deletion" on public.account_deletion_requests;
create policy "manage own deletion" on public.account_deletion_requests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Audit log (append-only; read self or admin) ──────────────────────────────
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text not null,
  target     text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_user on public.audit_log(user_id);
alter table public.audit_log enable row level security;
drop policy if exists "insert own audit" on public.audit_log;
create policy "insert own audit" on public.audit_log
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own audit" on public.audit_log;
create policy "read own audit" on public.audit_log
  for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ── Security / login events (for login history + security notifications) ──────
create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('login','logout','password_change','new_device','twofa_enabled','twofa_disabled','email_change')),
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_security_events_user on public.security_events(user_id, created_at desc);
alter table public.security_events enable row level security;
drop policy if exists "insert own security event" on public.security_events;
create policy "insert own security event" on public.security_events
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own security events" on public.security_events;
create policy "read own security events" on public.security_events
  for select to authenticated using (user_id = auth.uid());

-- Realtime for security events (live "new login" notifications).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'security_events'
  ) then
    alter publication supabase_realtime add table public.security_events;
  end if;
end $$;
