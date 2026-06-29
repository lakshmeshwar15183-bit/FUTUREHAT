-- FUTUREHAT — voice/video calling. The `calls` row tracks ring/accept/end state
-- and doubles as call history; the actual WebRTC SDP/ICE signaling rides on a
-- per-call Supabase realtime *broadcast* channel ("call:<id>"), so no payload is
-- persisted here. Idempotent. Uses public.is_member() from 0001_init.

create table if not exists public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id       uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in ('audio','video')),
  status          text not null default 'ringing'
                    check (status in ('ringing','accepted','declined','missed','ended')),
  started_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz
);

create index if not exists idx_calls_conversation on public.calls(conversation_id);
create index if not exists idx_calls_started on public.calls(started_at desc);

alter table public.calls enable row level security;

-- Any member of the conversation can see/create/update its calls.
drop policy if exists "read calls" on public.calls;
create policy "read calls" on public.calls
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "create calls" on public.calls;
create policy "create calls" on public.calls
  for insert to authenticated
  with check (caller_id = auth.uid() and public.is_member(conversation_id));

drop policy if exists "update calls" on public.calls;
create policy "update calls" on public.calls
  for update to authenticated
  using (public.is_member(conversation_id))
  with check (public.is_member(conversation_id));

-- Realtime: drives the incoming-call UI and live status changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;
