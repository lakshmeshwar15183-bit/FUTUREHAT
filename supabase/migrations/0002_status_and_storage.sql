-- Lumixo — Status/Stories + Storage buckets & policies

-- ---------------------------------------------------------------------------
-- statuses : ephemeral 24h stories
-- ---------------------------------------------------------------------------
create table if not exists public.statuses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null default 'image' check (type in ('image','text')),
  content    text,
  media_url  text,
  background text,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '24 hours')
);

create index if not exists idx_statuses_user on public.statuses(user_id, created_at);

alter table public.statuses enable row level security;

-- Any authenticated user can read non-expired statuses; you manage your own.
drop policy if exists "read statuses" on public.statuses;
create policy "read statuses" on public.statuses
  for select to authenticated using (expires_at > now());

drop policy if exists "insert own status" on public.statuses;
create policy "insert own status" on public.statuses
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own status" on public.statuses;
create policy "delete own status" on public.statuses
  for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.statuses;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('status', 'status', false)
on conflict (id) do nothing;

-- avatars: world-readable, owner-writable
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- media: readable & writable by authenticated users (RLS on messages governs access to URLs).
-- Files are stored under <conversation_id>/<filename>; signed URLs gate distribution.
drop policy if exists "media auth read" on storage.objects;
create policy "media auth read" on storage.objects
  for select to authenticated using (bucket_id = 'media');

drop policy if exists "media auth write" on storage.objects;
create policy "media auth write" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

-- status: readable by authenticated, writable by owner (folder = user id)
drop policy if exists "status auth read" on storage.objects;
create policy "status auth read" on storage.objects
  for select to authenticated using (bucket_id = 'status');

drop policy if exists "status owner write" on storage.objects;
create policy "status owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'status' and (storage.foldername(name))[1] = auth.uid()::text);
