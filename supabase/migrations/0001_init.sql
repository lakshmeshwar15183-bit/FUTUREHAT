-- FUTUREHAT — core chat schema
-- Real-time WhatsApp-style messaging on Supabase (Postgres + Auth + Realtime)
-- Run this in the Supabase SQL Editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles : one row per authenticated user (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  phone        text unique,
  username     text unique,
  display_name text,
  about        text default 'Hey there! I am using FUTUREHAT.',
  avatar_url   text,
  last_seen    timestamptz default now(),
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- conversations : a direct (1:1) or group chat
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'direct' check (type in ('direct','group')),
  name        text,                 -- group name (null for direct)
  avatar_url  text,                 -- group avatar
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- conversation_participants : who is in each conversation
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('member','admin')),
  joined_at       timestamptz default now(),
  primary key (conversation_id, user_id)
);

create index if not exists idx_participants_user on public.conversation_participants(user_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  type            text not null default 'text' check (type in ('text','image','file','audio')),
  content         text,             -- text body / caption
  media_url       text,             -- storage path for image/file/audio
  reply_to        uuid references public.messages(id) on delete set null,
  is_deleted      boolean default false,
  created_at      timestamptz default now(),
  edited_at       timestamptz
);

create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- message_receipts : per-user delivered/read state (the ✓ / ✓✓ ticks)
-- ---------------------------------------------------------------------------
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'delivered' check (status in ('delivered','read')),
  updated_at timestamptz default now(),
  primary key (message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Helper: is the current user a member of a conversation?
-- SECURITY DEFINER so it bypasses RLS and avoids recursive policy evaluation.
-- ---------------------------------------------------------------------------
create or replace function public.is_member(conv uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-create a profile whenever a new auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, display_name)
  values (new.id, new.phone, coalesce(new.raw_user_meta_data->>'display_name', 'FUTUREHAT user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
alter table public.message_receipts          enable row level security;

-- profiles: anyone authenticated can read profiles (to find people to chat with),
-- but you may only edit your own.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- conversations: visible only to members; any authenticated user can create one.
drop policy if exists "read member conversations" on public.conversations;
create policy "read member conversations" on public.conversations
  for select to authenticated using (public.is_member(id));

drop policy if exists "create conversations" on public.conversations;
create policy "create conversations" on public.conversations
  for insert to authenticated with check (created_by = auth.uid());

-- participants: you can see participant rows of conversations you belong to.
drop policy if exists "read participants" on public.conversation_participants;
create policy "read participants" on public.conversation_participants
  for select to authenticated using (public.is_member(conversation_id));

-- You can add participants to a conversation you belong to (and add yourself).
drop policy if exists "add participants" on public.conversation_participants;
create policy "add participants" on public.conversation_participants
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_member(conversation_id));

drop policy if exists "leave conversation" on public.conversation_participants;
create policy "leave conversation" on public.conversation_participants
  for delete to authenticated using (user_id = auth.uid());

-- messages: read if member; send as yourself into a conversation you belong to.
drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

drop policy if exists "edit own messages" on public.messages;
create policy "edit own messages" on public.messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- receipts: read for members of the message's conversation; write your own.
drop policy if exists "read receipts" on public.message_receipts;
create policy "read receipts" on public.message_receipts
  for select to authenticated using (
    public.is_member((select conversation_id from public.messages where id = message_id))
  );

drop policy if exists "write own receipts" on public.message_receipts;
create policy "write own receipts" on public.message_receipts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "update own receipts" on public.message_receipts;
create policy "update own receipts" on public.message_receipts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: broadcast row changes for these tables to subscribed clients
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_receipts;
alter publication supabase_realtime add table public.conversation_participants;

-- ---------------------------------------------------------------------------
-- RPC: start (or fetch) a 1:1 conversation with another user by their id.
-- Returns the conversation id. Idempotent for a given pair.
-- ---------------------------------------------------------------------------
create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  -- find an existing direct conversation containing exactly these two users
  select c.id into conv
  from public.conversations c
  join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = me
  join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = other_user
  where c.type = 'direct'
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into public.conversations (type, created_by) values ('direct', me) returning id into conv;
  insert into public.conversation_participants (conversation_id, user_id) values (conv, me), (conv, other_user);
  return conv;
end;
$$;
