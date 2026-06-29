-- FUTUREHAT — Communities, channels, broadcasts, polls and events.
-- Channels REUSE the existing conversations/messages/realtime stack: each channel
-- is backed by a conversation row, so all chat features work inside a channel for
-- free. Idempotent. Builds on public.is_member() from 0001_init.

-- ── Communities ───────────────────────────────────────────────────────────────
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  avatar_url  text,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('member','admin')),
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists idx_comm_members_user on public.community_members(user_id);

-- A channel is a conversation that belongs to a community.
create table if not exists public.channels (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  name            text not null,
  kind            text not null default 'text' check (kind in ('text','announcement','broadcast')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_channels_community on public.channels(community_id);

-- Membership helper for communities (SECURITY DEFINER to avoid RLS recursion).
create or replace function public.is_community_member(comm uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.community_members
    where community_id = comm and user_id = auth.uid()
  );
$$;

create or replace function public.is_community_admin(comm uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.community_members
    where community_id = comm and user_id = auth.uid() and role = 'admin'
  );
$$;

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.channels enable row level security;

drop policy if exists "read communities" on public.communities;
create policy "read communities" on public.communities
  for select to authenticated using (public.is_community_member(id) or owner_id = auth.uid());

drop policy if exists "create communities" on public.communities;
create policy "create communities" on public.communities
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "update communities" on public.communities;
create policy "update communities" on public.communities
  for update to authenticated using (public.is_community_admin(id) or owner_id = auth.uid());

drop policy if exists "read members" on public.community_members;
create policy "read members" on public.community_members
  for select to authenticated using (public.is_community_member(community_id));

drop policy if exists "join community" on public.community_members;
create policy "join community" on public.community_members
  for insert to authenticated with check (user_id = auth.uid() or public.is_community_admin(community_id));

drop policy if exists "leave community" on public.community_members;
create policy "leave community" on public.community_members
  for delete to authenticated using (user_id = auth.uid() or public.is_community_admin(community_id));

drop policy if exists "read channels" on public.channels;
create policy "read channels" on public.channels
  for select to authenticated using (public.is_community_member(community_id));

drop policy if exists "manage channels" on public.channels;
create policy "manage channels" on public.channels
  for insert to authenticated with check (public.is_community_admin(community_id));

-- ── Polls ─────────────────────────────────────────────────────────────────────
create table if not exists public.polls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by      uuid not null references auth.users(id) on delete cascade,
  question        text not null,
  options         jsonb not null,           -- string[]
  multiple        boolean not null default false,
  closes_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_polls_conversation on public.polls(conversation_id);

create table if not exists public.poll_votes (
  poll_id      uuid not null references public.polls(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  option_index integer not null,
  created_at   timestamptz not null default now(),
  primary key (poll_id, user_id, option_index)
);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "read polls" on public.polls;
create policy "read polls" on public.polls
  for select to authenticated using (public.is_member(conversation_id));
drop policy if exists "create polls" on public.polls;
create policy "create polls" on public.polls
  for insert to authenticated with check (created_by = auth.uid() and public.is_member(conversation_id));

drop policy if exists "read votes" on public.poll_votes;
create policy "read votes" on public.poll_votes
  for select to authenticated
  using (public.is_member((select conversation_id from public.polls where id = poll_id)));
drop policy if exists "cast vote" on public.poll_votes;
create policy "cast vote" on public.poll_votes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "retract vote" on public.poll_votes;
create policy "retract vote" on public.poll_votes
  for delete to authenticated using (user_id = auth.uid());

-- ── Events ────────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  community_id    uuid references public.communities(id) on delete cascade,
  title           text not null,
  description     text,
  location        text,
  starts_at       timestamptz not null,
  created_by      uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index if not exists idx_events_conversation on public.events(conversation_id);
create index if not exists idx_events_community on public.events(community_id);

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null check (status in ('going','maybe','no')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

drop policy if exists "read events" on public.events;
create policy "read events" on public.events
  for select to authenticated using (
    (conversation_id is not null and public.is_member(conversation_id))
    or (community_id is not null and public.is_community_member(community_id))
  );
drop policy if exists "create events" on public.events;
create policy "create events" on public.events
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "read rsvps" on public.event_rsvps;
create policy "read rsvps" on public.event_rsvps
  for select to authenticated using (true);
drop policy if exists "set rsvp" on public.event_rsvps;
create policy "set rsvp" on public.event_rsvps
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update rsvp" on public.event_rsvps;
create policy "update rsvp" on public.event_rsvps
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime for live community/poll/event updates.
do $$
declare t text;
begin
  foreach t in array array['communities','community_members','channels','polls','poll_votes','events','event_rsvps']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
