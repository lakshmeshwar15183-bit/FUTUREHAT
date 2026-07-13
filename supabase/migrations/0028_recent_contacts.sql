-- Lumixo — recent contacts / previously-chatted-users history
-- ---------------------------------------------------------------------------
-- Problem this solves: the "New Chat" screen only ever showed users returned by
-- a live search. Anyone you had already chatted with vanished the moment you
-- deleted the conversation, because there was no persistent record of "people I
-- have talked to" — only the (deletable) conversations list.
--
-- This adds a small, dedicated relationship table that is INDEPENDENT of the
-- conversations/deleted_conversations machinery, so deleting a chat never
-- removes the person from your New Chat history. Each user only ever sees and
-- mutates their OWN rows (RLS below).
-- ---------------------------------------------------------------------------

create table if not exists public.recent_contacts (
  owner_id             uuid not null references public.profiles(id) on delete cascade,
  contact_id           uuid not null references public.profiles(id) on delete cascade,
  first_interaction_at timestamptz not null default now(),
  last_interaction_at  timestamptz not null default now(),
  primary key (owner_id, contact_id),
  -- a user is never their own recent contact
  constraint recent_contacts_no_self check (owner_id <> contact_id)
);

-- List a user's history newest-first (the common read path).
create index if not exists idx_recent_contacts_owner
  on public.recent_contacts(owner_id, last_interaction_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: a user may only read / add / update / remove entries in
-- their OWN history. contact_id is never trusted for authorization — only
-- owner_id (bound to auth.uid()) is. Adds are normally performed by the
-- SECURITY DEFINER start_direct_conversation() below, but a direct client
-- insert (offline-first optimistic add) is still constrained to owner_id = me.
-- ---------------------------------------------------------------------------
alter table public.recent_contacts enable row level security;

drop policy if exists "read own recent contacts" on public.recent_contacts;
create policy "read own recent contacts" on public.recent_contacts
  for select to authenticated using (auth.uid() = owner_id);

drop policy if exists "insert own recent contacts" on public.recent_contacts;
create policy "insert own recent contacts" on public.recent_contacts
  for insert to authenticated with check (auth.uid() = owner_id and owner_id <> contact_id);

drop policy if exists "update own recent contacts" on public.recent_contacts;
create policy "update own recent contacts" on public.recent_contacts
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "delete own recent contacts" on public.recent_contacts;
create policy "delete own recent contacts" on public.recent_contacts
  for delete to authenticated using (auth.uid() = owner_id);

grant select, insert, update, delete on public.recent_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- Hook the recent-contacts write into the single chokepoint that every entry
-- point (New Chat, Profile, Status viewer — mobile AND web) already funnels
-- through. Running as SECURITY DEFINER lets it record BOTH directions of the
-- pair (me→other and other→me) in one statement, bypassing RLS for the second
-- owner. Behaviour for the conversation itself is unchanged; we only added the
-- upsert before the return.
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

  if conv is null then
    insert into public.conversations (type, created_by) values ('direct', me) returning id into conv;
    insert into public.conversation_participants (conversation_id, user_id) values (conv, me), (conv, other_user);
  end if;

  -- Record the pair in each user's persistent recent-contacts history. Idempotent:
  -- re-opening an existing chat just bumps last_interaction_at. Never fires for a
  -- self-conversation.
  if other_user is not null and other_user <> me then
    insert into public.recent_contacts (owner_id, contact_id)
    values (me, other_user), (other_user, me)
    on conflict (owner_id, contact_id) do update set last_interaction_at = now();
  end if;

  return conv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: seed history from every EXISTING direct conversation so people you
-- already chat with appear in New Chat immediately after this migration, even
-- for conversations created before the feature existed. Both directions are
-- produced by the self-join over participants. Idempotent.
-- ---------------------------------------------------------------------------
insert into public.recent_contacts (owner_id, contact_id, first_interaction_at, last_interaction_at)
select
  p1.user_id,
  p2.user_id,
  c.created_at,
  coalesce((select max(m.created_at) from public.messages m where m.conversation_id = c.id), c.created_at)
from public.conversations c
join public.conversation_participants p1 on p1.conversation_id = c.id
join public.conversation_participants p2 on p2.conversation_id = c.id
where c.type = 'direct'
  and p1.user_id <> p2.user_id
on conflict (owner_id, contact_id) do nothing;
