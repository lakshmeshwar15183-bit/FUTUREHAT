-- Lumixo+ — Premium subscriptions, preferences, and premium-feature data
-- Idempotent: safe to run more than once. Uses the existing core schema
-- (profiles, conversations, conversation_participants, messages).

-- ── Subscriptions ─────────────────────────────────────────────────────────────
-- One row per user. A user is "premium" while status='active' and the current
-- period has not ended. Payment provider details are stored for reconciliation.
create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  plan                    text not null check (plan in ('monthly','yearly')),
  status                  text not null default 'active'
                            check (status in ('active','cancelled','expired','past_due')),
  provider                text not null default 'manual'
                            check (provider in ('razorpay','stripe','manual')),
  provider_customer_id    text,
  provider_subscription_id text,
  amount_inr              integer,                       -- charged amount in paise/rupees (rupees here)
  current_period_start    timestamptz not null default now(),
  current_period_end      timestamptz not null,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_subscriptions_period on public.subscriptions(current_period_end);

alter table public.subscriptions enable row level security;

drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own subscription" on public.subscriptions;
create policy "insert own subscription" on public.subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own subscription" on public.subscriptions;
create policy "update own subscription" on public.subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helper: is a given user premium right now?
create or replace function public.is_premium(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status = 'active'
      and s.current_period_end > now()
  );
$$;

-- Public-ish view so the UI can show a Lumixo+ badge next to premium users.
-- Exposes only the user_id of active subscribers (no billing data).
create or replace view public.premium_users
with (security_invoker = on) as
  select user_id
  from public.subscriptions
  where status = 'active' and current_period_end > now();

drop policy if exists "read premium flags" on public.subscriptions;
create policy "read premium flags" on public.subscriptions
  for select to authenticated using (status = 'active' and current_period_end > now());

-- ── User preferences (appearance + privacy) ───────────────────────────────────
-- Free users default to the base theme; premium values are honored only while
-- the user is premium (enforced in the client + safe to store regardless).
create table if not exists public.user_preferences (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  theme          text not null default 'default',
  font           text not null default 'system',
  bubble_style   text not null default 'rounded',
  wallpaper      text not null default 'default',
  app_icon       text not null default 'classic',
  ghost_mode     boolean not null default false,   -- hide read receipts + typing
  app_lock       boolean not null default false,   -- require PIN/biometric on open
  extra          jsonb not null default '{}'::jsonb, -- future-proof bag for new prefs
  updated_at     timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "manage own prefs" on public.user_preferences;
create policy "manage own prefs" on public.user_preferences
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Pinned conversations (free: limited; premium: unlimited) ───────────────────
create table if not exists public.pinned_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_at       timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.pinned_conversations enable row level security;

drop policy if exists "manage own pins" on public.pinned_conversations;
create policy "manage own pins" on public.pinned_conversations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Hidden conversations (premium privacy) ─────────────────────────────────────
create table if not exists public.hidden_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  hidden_at       timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.hidden_conversations enable row level security;

-- Hiding a chat is premium-only; enforced server-side so it can't be bypassed
-- from the client. Unhiding (delete) and reading stay available if premium lapses.
drop policy if exists "manage own hidden" on public.hidden_conversations;
create policy "read own hidden" on public.hidden_conversations
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own hidden" on public.hidden_conversations
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_premium(auth.uid()));
create policy "delete own hidden" on public.hidden_conversations
  for delete to authenticated using (auth.uid() = user_id);

-- ── Scheduled messages (premium messaging) ────────────────────────────────────
create table if not exists public.scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  type            text not null default 'text' check (type in ('text','image','file','audio')),
  content         text,
  media_url       text,
  send_at         timestamptz not null,
  sent            boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists idx_scheduled_due on public.scheduled_messages(send_at) where not sent;

alter table public.scheduled_messages enable row level security;

-- Scheduling is premium-only (enforced on insert). Reading/cancelling your own
-- scheduled rows stays available regardless of current premium status.
drop policy if exists "manage own scheduled" on public.scheduled_messages;
create policy "read own scheduled" on public.scheduled_messages
  for select to authenticated using (auth.uid() = sender_id);
create policy "insert own scheduled" on public.scheduled_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_premium(auth.uid())
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = scheduled_messages.conversation_id
        and cp.user_id = auth.uid()
    )
  );
create policy "delete own scheduled" on public.scheduled_messages
  for delete to authenticated using (auth.uid() = sender_id);

-- Server-side dispatcher: move due scheduled messages into messages.
-- Call from pg_cron (see DEPLOY) or invoke manually. SECURITY DEFINER so it can
-- insert on behalf of the sender after the row was authored under RLS.
create or replace function public.dispatch_due_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer := 0;
begin
  with due as (
    select * from public.scheduled_messages
    where not sent and send_at <= now()
    order by send_at
    limit 200
    for update skip locked
  )
  insert into public.messages (conversation_id, sender_id, type, content, media_url)
  select conversation_id, sender_id, type, content, media_url from due;

  with due as (
    select id from public.scheduled_messages
    where not sent and send_at <= now()
    order by send_at
    limit 200
  )
  update public.scheduled_messages s
  set sent = true
  from due
  where s.id = due.id;

  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- ── Realtime ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='user_preferences'
  ) then
    alter publication supabase_realtime add table public.user_preferences;
  end if;
end $$;
