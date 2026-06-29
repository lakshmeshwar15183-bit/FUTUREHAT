-- 0011_message_extras.sql — WhatsApp-style message extras: forwarded flag,
-- starred messages, and per-user "delete for me". Idempotent. Apply after 0010.
-- ============================================================================

-- Forwarded marker on messages (shows a "Forwarded" label).
alter table public.messages add column if not exists is_forwarded boolean not null default false;

-- Starred / bookmarked messages (per user).
create table if not exists public.starred_messages (
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.starred_messages enable row level security;
drop policy if exists "manage own stars" on public.starred_messages;
create policy "manage own stars" on public.starred_messages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "Delete for me": hide a message for one user without deleting it for everyone.
create table if not exists public.hidden_messages (
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.hidden_messages enable row level security;
drop policy if exists "manage own hidden messages" on public.hidden_messages;
create policy "manage own hidden messages" on public.hidden_messages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
