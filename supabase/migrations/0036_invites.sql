-- Lumixo — shareable invite links for groups (conversations) and communities.
-- A row is a join token an admin generates; anyone with the token can join via
-- the join_by_invite() SECURITY DEFINER RPC (which bypasses the membership-write
-- RLS the same way create_group_conversation does). Optional expiry / max-uses.

create table if not exists public.invites (
  token       text primary key,
  target_type text not null check (target_type in ('conversation','community')),
  target_id   uuid not null,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked     boolean not null default false,
  max_uses    integer,
  use_count   integer not null default 0
);
create index if not exists idx_invites_target on public.invites(target_type, target_id);

alter table public.invites enable row level security;

-- Read: any authenticated user can resolve an invite (they must already know the
-- opaque token — this powers the join-preview screen).
drop policy if exists "read invites" on public.invites;
create policy "read invites" on public.invites
  for select to authenticated using (true);

-- Create: only an admin of the target group/community, inserting as themselves.
drop policy if exists "create invites" on public.invites;
create policy "create invites" on public.invites
  for insert to authenticated with check (
    created_by = auth.uid() and (
      (target_type = 'conversation' and exists (
        select 1 from public.conversation_participants p
        where p.conversation_id = target_id and p.user_id = auth.uid() and p.role = 'admin'
      ))
      or (target_type = 'community' and public.is_community_admin(target_id))
    )
  );

-- Revoke (update) / delete: same admin check.
drop policy if exists "manage invites" on public.invites;
create policy "manage invites" on public.invites
  for update to authenticated using (
    (target_type = 'conversation' and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = target_id and p.user_id = auth.uid() and p.role = 'admin'
    ))
    or (target_type = 'community' and public.is_community_admin(target_id))
  );

drop policy if exists "delete invites" on public.invites;
create policy "delete invites" on public.invites
  for delete to authenticated using (
    (target_type = 'conversation' and exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = target_id and p.user_id = auth.uid() and p.role = 'admin'
    ))
    or (target_type = 'community' and public.is_community_admin(target_id))
  );

-- Join via a token. SECURITY DEFINER so it can write membership rows the caller
-- can't write directly (mirrors create_group_conversation). Validates state and
-- is idempotent per (target, user).
create or replace function public.join_by_invite(p_token text)
returns table (target_type text, target_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  me  uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select * into inv from public.invites where token = p_token;
  if inv.token is null then
    raise exception 'invalid invite';
  end if;
  if inv.revoked then
    raise exception 'invite revoked';
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception 'invite expired';
  end if;
  if inv.max_uses is not null and inv.use_count >= inv.max_uses then
    raise exception 'invite fully used';
  end if;

  if inv.target_type = 'conversation' then
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (inv.target_id, me, 'member')
    on conflict (conversation_id, user_id) do nothing;
  elsif inv.target_type = 'community' then
    insert into public.community_members (community_id, user_id, role)
    values (inv.target_id, me, 'member')
    on conflict (community_id, user_id) do nothing;
  else
    raise exception 'unknown invite target';
  end if;

  update public.invites set use_count = use_count + 1 where token = p_token;

  return query select inv.target_type, inv.target_id;
end;
$$;

grant execute on function public.join_by_invite(text) to authenticated;
