-- Lumixo — Status/Stories: video type + per-viewer seen tracking
-- Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. Allow 'video' statuses (was image|text only)
-- ---------------------------------------------------------------------------
alter table public.statuses drop constraint if exists statuses_type_check;
alter table public.statuses
  add constraint statuses_type_check check (type in ('image', 'text', 'video'));

-- ---------------------------------------------------------------------------
-- 2. status_views : who has seen which status (WhatsApp "seen by" list)
-- ---------------------------------------------------------------------------
create table if not exists public.status_views (
  status_id  uuid not null references public.statuses(id) on delete cascade,
  viewer_id  uuid not null references public.profiles(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

create index if not exists idx_status_views_status on public.status_views(status_id);
create index if not exists idx_status_views_viewer on public.status_views(viewer_id);

alter table public.status_views enable row level security;

-- A viewer records their own view.
drop policy if exists "insert own view" on public.status_views;
create policy "insert own view" on public.status_views
  for insert to authenticated
  with check (viewer_id = auth.uid());

-- A viewer can read their own view rows (used to compute seen/unseen rings);
-- the status owner can read every view of their statuses (the "seen by" list).
drop policy if exists "read relevant views" on public.status_views;
create policy "read relevant views" on public.status_views
  for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.statuses s
      where s.id = status_views.status_id and s.user_id = auth.uid()
    )
  );

-- Views vanish with their status (cascade) — no explicit delete policy needed.

alter publication supabase_realtime add table public.status_views;
