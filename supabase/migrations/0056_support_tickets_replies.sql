-- 0056_support_tickets_replies.sql
-- Production support center: human-readable ticket IDs + in-app replies.

-- Public reference e.g. LMX-A1B2C3D4 (unique, shown in UI / emails).
alter table public.support_tickets
  add column if not exists public_id text;

-- Backfill existing rows.
update public.support_tickets
set public_id = 'LMX-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where public_id is null or public_id = '';

alter table public.support_tickets
  alter column public_id set not null;

create unique index if not exists uq_support_tickets_public_id
  on public.support_tickets (public_id);

-- Auto-assign public_id on insert.
create or replace function public.support_ticket_set_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or trim(new.public_id) = '' then
    new.public_id := 'LMX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_support_ticket_public_id on public.support_tickets;
create trigger trg_support_ticket_public_id
  before insert on public.support_tickets
  for each row execute function public.support_ticket_set_public_id();

-- Thread replies (user or staff). Staff writes via service_role / admin policies.
create table if not exists public.support_ticket_replies (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  is_staff    boolean not null default false,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists idx_support_ticket_replies_ticket
  on public.support_ticket_replies (ticket_id, created_at);

alter table public.support_ticket_replies enable row level security;

-- Users read/write replies only on their own tickets; staff flag always false from client.
drop policy if exists "read own ticket replies" on public.support_ticket_replies;
create policy "read own ticket replies" on public.support_ticket_replies
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "insert own ticket replies" on public.support_ticket_replies;
create policy "insert own ticket replies" on public.support_ticket_replies
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and is_staff = false
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.user_id = auth.uid()
    )
  );

-- Admin/moderator read+reply via existing admin role helpers if present.
drop policy if exists "admin manage ticket replies" on public.support_ticket_replies;
create policy "admin manage ticket replies" on public.support_ticket_replies
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.is_owner(auth.uid()))
  with check (public.is_admin(auth.uid()) or public.is_owner(auth.uid()));
