-- Add message reactions table
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Enable RLS
alter table public.message_reactions enable row level security;

-- Policies: can read reactions in conversations you're in
create policy "Users can read reactions in their conversations"
  on public.message_reactions for select
  using (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id
      where m.id = message_id and cp.user_id = auth.uid()
    )
  );

-- Can insert/delete your own reactions
create policy "Users can add their own reactions"
  on public.message_reactions for insert
  with check (auth.uid() = user_id);

create policy "Users can remove their own reactions"
  on public.message_reactions for delete
  using (auth.uid() = user_id);

-- Index for fast lookups
create index if not exists idx_message_reactions_message_id on public.message_reactions(message_id);

-- Stream reaction changes over Realtime to subscribed clients (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
