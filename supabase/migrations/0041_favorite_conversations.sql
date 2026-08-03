-- 0041_favorite_conversations.sql
-- WhatsApp-class "Favourite chats" (per-user), separate from starred messages.
-- Mirrors pinned_conversations: local-first client cache + RLS + realtime.

create table if not exists public.favorite_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  favorited_at    timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists favorite_conversations_user_idx
  on public.favorite_conversations (user_id, favorited_at desc);

alter table public.favorite_conversations enable row level security;

drop policy if exists "manage own favorites" on public.favorite_conversations;
create policy "manage own favorites" on public.favorite_conversations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Realtime so other devices update favourites without a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'favorite_conversations'
  ) then
    alter publication supabase_realtime add table public.favorite_conversations;
  end if;
exception when others then
  -- publication may already include the table or lack privileges in some envs
  null;
end $$;

-- Ensure pin order is queryable (pinned_at already exists from 0003).
create index if not exists pinned_conversations_user_pinned_at_idx
  on public.pinned_conversations (user_id, pinned_at asc);
