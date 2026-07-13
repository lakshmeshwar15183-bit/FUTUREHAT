-- Lumixo — group poll production polish (additive only).
-- • anonymous flag (hide voter identities in UI)
-- • creator may update closes_at (close poll) and anonymous
-- Does not change vote tables, messaging, communities, or calls.

alter table public.polls
  add column if not exists anonymous boolean not null default false;

-- Creator (or group admin via is_member + created_by) can close / tweak poll meta.
drop policy if exists "update own polls" on public.polls;
create policy "update own polls" on public.polls
  for update to authenticated
  using (created_by = auth.uid() and public.is_member(conversation_id))
  with check (created_by = auth.uid() and public.is_member(conversation_id));

comment on column public.polls.anonymous is
  'When true, clients hide voter names; tallies still visible.';
