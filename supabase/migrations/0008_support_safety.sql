-- FUTUREHAT — trust & safety: reports, support tickets, ban appeals, feedback,
-- blocks and mutes. Idempotent. Builds on the core schema.

-- ── Reports (user / message / group / channel) ───────────────────────────────
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references auth.users(id) on delete cascade,
  target_type   text not null check (target_type in ('user','message','conversation','channel','community')),
  target_id     uuid not null,
  reason        text not null,
  details       text,
  status        text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_reports_reporter on public.reports(reporter_id);

-- ── Support tickets / bug reports / feedback / ban appeals ────────────────────
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('support','bug','feedback','appeal','grievance')),
  subject     text not null,
  body        text not null,
  attachment_url text,
  device_info text,
  status      text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_tickets_user on public.support_tickets(user_id);

-- ── Blocks & mutes ────────────────────────────────────────────────────────────
create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists public.muted_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  muted_until     timestamptz,
  created_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.reports enable row level security;
alter table public.support_tickets enable row level security;
alter table public.blocked_users enable row level security;
alter table public.muted_conversations enable row level security;

-- Users manage only their own rows.
drop policy if exists "insert own report" on public.reports;
create policy "insert own report" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "read own report" on public.reports;
create policy "read own report" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

drop policy if exists "insert own ticket" on public.support_tickets;
create policy "insert own ticket" on public.support_tickets
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own ticket" on public.support_tickets;
create policy "read own ticket" on public.support_tickets
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "manage own blocks" on public.blocked_users;
create policy "manage own blocks" on public.blocked_users
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

drop policy if exists "manage own mutes" on public.muted_conversations;
create policy "manage own mutes" on public.muted_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
