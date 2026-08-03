-- 0037_group_system.sql
-- Production WhatsApp-class group system for FUTUREHAT / Lumixo.
-- Additive + idempotent. Extends conversations/participants, adds join
-- requests, pinned messages, permission columns, and SECURITY DEFINER RPCs
-- that enforce admin/super_admin rules server-side (no privilege escalation).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Schema: group metadata + WhatsApp-style permissions on conversations
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists description text;

alter table public.conversations
  add column if not exists only_admins_can_send boolean not null default false;

alter table public.conversations
  add column if not exists only_admins_can_edit_info boolean not null default true;

alter table public.conversations
  add column if not exists only_admins_can_add_members boolean not null default true;

alter table public.conversations
  add column if not exists only_admins_can_pin boolean not null default true;

alter table public.conversations
  add column if not exists only_admins_manage_disappearing boolean not null default true;

alter table public.conversations
  add column if not exists approve_new_members boolean not null default false;

alter table public.conversations
  add column if not exists member_history_visible boolean not null default true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Roles: member | admin | super_admin (creator / owner)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversation_participants
  drop constraint if exists conversation_participants_role_check;

alter table public.conversation_participants
  add constraint conversation_participants_role_check
  check (role in ('member', 'admin', 'super_admin'));

-- Promote historical group creators to super_admin where they are still admin.
update public.conversation_participants cp
set role = 'super_admin'
from public.conversations c
where c.id = cp.conversation_id
  and c.type = 'group'
  and c.created_by = cp.user_id
  and cp.role = 'admin';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Join requests (invite-link approval flow)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.group_join_requests (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  primary key (conversation_id, user_id)
);

create index if not exists idx_group_join_requests_pending
  on public.group_join_requests(conversation_id)
  where status = 'pending';

alter table public.group_join_requests enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Pinned messages (per conversation, WhatsApp-style)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id      uuid not null references public.messages(id) on delete cascade,
  pinned_by       uuid not null references public.profiles(id) on delete cascade,
  pinned_at       timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

create index if not exists idx_pinned_messages_conv
  on public.conversation_pinned_messages(conversation_id, pinned_at desc);

alter table public.conversation_pinned_messages enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Helpers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_group_admin(conv uuid, uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv
      and user_id = uid
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_group_super_admin(conv uuid, uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv
      and user_id = uid
      and role = 'super_admin'
  );
$$;

create or replace function public.group_member_role(conv uuid, uid uuid default auth.uid())
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.conversation_participants
  where conversation_id = conv and user_id = uid
  limit 1;
$$;

-- Insert a system notice (SECURITY DEFINER so group RPCs can post them).
-- Not granted to authenticated — only other SECURITY DEFINER functions call it.
create or replace function public.post_system_message(p_conv uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  me  uuid := auth.uid();
  sender uuid;
begin
  if p_text is null or length(trim(p_text)) = 0 then
    return null;
  end if;
  sender := coalesce(me, (select created_by from public.conversations where id = p_conv));
  if sender is null then
    return null;
  end if;
  insert into public.messages (conversation_id, sender_id, type, content)
  values (p_conv, sender, 'system', trim(p_text))
  returning id into mid;
  return mid;
end;
$$;

-- Display name helper for system messages.
create or replace function public._profile_label(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(display_name, ''), nullif(username, ''), 'Someone')
  from public.profiles where id = uid;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Create group (full signature, super_admin, system message, description)
-- Drop prior overloads so CREATE OR REPLACE doesn't leave a stale 3-arg version.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.create_group_conversation(text, uuid[]);
drop function if exists public.create_group_conversation(text, uuid[], text);
drop function if exists public.create_group_conversation(text, uuid[], text, text);

create or replace function public.create_group_conversation(
  p_name        text,
  p_member_ids  uuid[],
  p_avatar_url  text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  me   uuid := auth.uid();
  pid  uuid;
  creator_name text;
  member_names text := '';
  n int := 0;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'group name is required';
  end if;

  insert into public.conversations (type, name, avatar_url, description, created_by)
  values ('group', trim(p_name), p_avatar_url, nullif(trim(coalesce(p_description, '')), ''), me)
  returning id into conv;

  -- Creator is Super Admin (WhatsApp "group admin" who created the group).
  insert into public.conversation_participants (conversation_id, user_id, role)
  values (conv, me, 'super_admin');

  if p_member_ids is not null then
    foreach pid in array p_member_ids loop
      if pid is distinct from me then
        insert into public.conversation_participants (conversation_id, user_id, role)
        values (conv, pid, 'member')
        on conflict (conversation_id, user_id) do nothing;
        n := n + 1;
        if n <= 3 then
          member_names := member_names
            || case when member_names = '' then '' else ', ' end
            || public._profile_label(pid);
        end if;
      end if;
    end loop;
  end if;

  creator_name := public._profile_label(me);
  if n = 0 then
    perform public.post_system_message(conv, creator_name || ' created this group');
  elsif n <= 3 then
    perform public.post_system_message(
      conv,
      creator_name || ' created this group and added ' || member_names
    );
  else
    perform public.post_system_message(
      conv,
      creator_name || ' created this group and added ' || member_names || ' and '
        || (n - 3)::text || ' others'
    );
  end if;

  return conv;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[], text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Update group info (name / description / avatar)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.update_group_info(
  p_conversation uuid,
  p_name         text default null,
  p_description  text default null,
  p_avatar_url   text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations%rowtype;
  me uuid := auth.uid();
  me_role text;
  old_name text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into c from public.conversations where id = p_conversation and type = 'group';
  if c.id is null then raise exception 'group not found'; end if;

  me_role := public.group_member_role(p_conversation, me);
  if me_role is null then raise exception 'not a member'; end if;

  if c.only_admins_can_edit_info and me_role not in ('admin', 'super_admin') then
    raise exception 'only admins can edit group info';
  end if;

  old_name := c.name;

  update public.conversations set
    name = case when p_name is not null and length(trim(p_name)) > 0 then trim(p_name) else name end,
    description = case when p_description is not null then nullif(trim(p_description), '') else description end,
    avatar_url = case
      when p_clear_avatar then null
      when p_avatar_url is not null then p_avatar_url
      else avatar_url
    end
  where id = p_conversation;

  if p_name is not null and length(trim(p_name)) > 0 and trim(p_name) is distinct from old_name then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' changed the group name to "' || trim(p_name) || '"'
    );
  end if;

  if p_clear_avatar or p_avatar_url is not null then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' changed this group''s icon'
    );
  end if;

  if p_description is not null then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' changed the group description'
    );
  end if;
end;
$$;

grant execute on function public.update_group_info(uuid, text, text, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Group permissions (admin-only)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_group_permissions(
  p_conversation uuid,
  p_only_admins_can_send boolean default null,
  p_only_admins_can_edit_info boolean default null,
  p_only_admins_can_add_members boolean default null,
  p_only_admins_can_pin boolean default null,
  p_only_admins_manage_disappearing boolean default null,
  p_approve_new_members boolean default null,
  p_member_history_visible boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_conversation, me) then
    raise exception 'only admins can change group permissions';
  end if;
  if not exists (
    select 1 from public.conversations where id = p_conversation and type = 'group'
  ) then
    raise exception 'group not found';
  end if;

  update public.conversations set
    only_admins_can_send = coalesce(p_only_admins_can_send, only_admins_can_send),
    only_admins_can_edit_info = coalesce(p_only_admins_can_edit_info, only_admins_can_edit_info),
    only_admins_can_add_members = coalesce(p_only_admins_can_add_members, only_admins_can_add_members),
    only_admins_can_pin = coalesce(p_only_admins_can_pin, only_admins_can_pin),
    only_admins_manage_disappearing = coalesce(p_only_admins_manage_disappearing, only_admins_manage_disappearing),
    approve_new_members = coalesce(p_approve_new_members, approve_new_members),
    member_history_visible = coalesce(p_member_history_visible, member_history_visible)
  where id = p_conversation;
end;
$$;

grant execute on function public.set_group_permissions(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Member management
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_group_members(
  p_conversation uuid,
  p_member_ids   uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations%rowtype;
  me uuid := auth.uid();
  me_role text;
  pid uuid;
  added int := 0;
  labels text := '';
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into c from public.conversations where id = p_conversation and type = 'group';
  if c.id is null then raise exception 'group not found'; end if;

  me_role := public.group_member_role(p_conversation, me);
  if me_role is null then raise exception 'not a member'; end if;
  if c.only_admins_can_add_members and me_role not in ('admin', 'super_admin') then
    raise exception 'only admins can add members';
  end if;

  if p_member_ids is null then return 0; end if;

  foreach pid in array p_member_ids loop
    if pid is null or pid = me then continue; end if;
    if exists (
      select 1 from public.conversation_participants
      where conversation_id = p_conversation and user_id = pid
    ) then
      continue;
    end if;
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (p_conversation, pid, 'member');
    added := added + 1;
    if added <= 3 then
      labels := labels || case when labels = '' then '' else ', ' end || public._profile_label(pid);
    end if;
  end loop;

  if added = 1 then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' added ' || labels
    );
  elsif added > 1 then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' added ' || labels
        || case when added > 3 then ' and ' || (added - 3)::text || ' others' else '' end
    );
  end if;

  return added;
end;
$$;

grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_group_member(
  p_conversation uuid,
  p_user_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  me_role text;
  target_role text;
  target_name text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'group not found';
  end if;

  me_role := public.group_member_role(p_conversation, me);
  target_role := public.group_member_role(p_conversation, p_user_id);
  if me_role is null then raise exception 'not a member'; end if;
  if target_role is null then raise exception 'user is not a member'; end if;

  -- Self-leave uses leave_group().
  if p_user_id = me then
    raise exception 'use leave_group to leave';
  end if;

  -- Only admins may remove; super_admin may remove anyone; admin may remove members only.
  if me_role not in ('admin', 'super_admin') then
    raise exception 'only admins can remove members';
  end if;
  if target_role = 'super_admin' then
    raise exception 'cannot remove the group owner';
  end if;
  if me_role = 'admin' and target_role = 'admin' then
    raise exception 'only the group owner can remove other admins';
  end if;

  target_name := public._profile_label(p_user_id);
  delete from public.conversation_participants
  where conversation_id = p_conversation and user_id = p_user_id;

  perform public.post_system_message(
    p_conversation,
    public._profile_label(me) || ' removed ' || target_name
  );
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

create or replace function public.set_group_member_role(
  p_conversation uuid,
  p_user_id      uuid,
  p_role         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  me_role text;
  target_role text;
  target_name text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_role not in ('member', 'admin') then
    raise exception 'role must be member or admin (use transfer_group_ownership for owner)';
  end if;

  me_role := public.group_member_role(p_conversation, me);
  target_role := public.group_member_role(p_conversation, p_user_id);
  if me_role is null then raise exception 'not a member'; end if;
  if target_role is null then raise exception 'user is not a member'; end if;
  if target_role = 'super_admin' then
    raise exception 'cannot change the owner role this way';
  end if;

  -- Only super_admin can promote/demote admins (WhatsApp-style edit-group-admins).
  if me_role <> 'super_admin' then
    raise exception 'only the group owner can change admin roles';
  end if;
  if p_user_id = me then
    raise exception 'cannot change your own role this way';
  end if;

  update public.conversation_participants
  set role = p_role
  where conversation_id = p_conversation and user_id = p_user_id;

  target_name := public._profile_label(p_user_id);
  if p_role = 'admin' then
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' made ' || target_name || ' an admin'
    );
  else
    perform public.post_system_message(
      p_conversation,
      public._profile_label(me) || ' removed ' || target_name || ' as admin'
    );
  end if;
end;
$$;

grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;

create or replace function public.transfer_group_ownership(
  p_conversation uuid,
  p_new_owner    uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_super_admin(p_conversation, me) then
    raise exception 'only the group owner can transfer ownership';
  end if;
  if p_new_owner = me then raise exception 'already the owner'; end if;
  if public.group_member_role(p_conversation, p_new_owner) is null then
    raise exception 'new owner must be a member';
  end if;

  update public.conversation_participants
  set role = 'admin'
  where conversation_id = p_conversation and user_id = me;

  update public.conversation_participants
  set role = 'super_admin'
  where conversation_id = p_conversation and user_id = p_new_owner;

  update public.conversations
  set created_by = p_new_owner
  where id = p_conversation;

  perform public.post_system_message(
    p_conversation,
    public._profile_label(me) || ' transferred ownership to ' || public._profile_label(p_new_owner)
  );
end;
$$;

grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

create or replace function public.leave_group(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  me_role text;
  other_admin uuid;
  remaining int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'group not found';
  end if;

  me_role := public.group_member_role(p_conversation, me);
  if me_role is null then raise exception 'not a member'; end if;

  select count(*) into remaining
  from public.conversation_participants
  where conversation_id = p_conversation and user_id <> me;

  -- Owner leaving: transfer to another admin, else oldest member, else dissolve.
  if me_role = 'super_admin' then
    if remaining = 0 then
      delete from public.conversations where id = p_conversation;
      return;
    end if;
    select user_id into other_admin
    from public.conversation_participants
    where conversation_id = p_conversation and user_id <> me and role = 'admin'
    order by joined_at
    limit 1;
    if other_admin is null then
      select user_id into other_admin
      from public.conversation_participants
      where conversation_id = p_conversation and user_id <> me
      order by joined_at
      limit 1;
    end if;
    if other_admin is not null then
      update public.conversation_participants
      set role = 'super_admin'
      where conversation_id = p_conversation and user_id = other_admin;
      update public.conversations set created_by = other_admin where id = p_conversation;
      perform public.post_system_message(
        p_conversation,
        public._profile_label(other_admin) || ' is now the group owner'
      );
    end if;
  end if;

  perform public.post_system_message(
    p_conversation,
    public._profile_label(me) || ' left'
  );

  delete from public.conversation_participants
  where conversation_id = p_conversation and user_id = me;
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;

create or replace function public.delete_group(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'group not found';
  end if;
  if not public.is_group_super_admin(p_conversation, me) then
    raise exception 'only the group owner can delete the group';
  end if;
  delete from public.conversations where id = p_conversation;
end;
$$;

grant execute on function public.delete_group(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Invite links (get-or-create, reset, revoke) + join with approval
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_or_create_group_invite(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tok text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_conversation, me) then
    raise exception 'only admins can manage invite links';
  end if;
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'group not found';
  end if;

  select token into tok
  from public.invites
  where target_type = 'conversation'
    and target_id = p_conversation
    and revoked = false
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if tok is not null then
    return tok;
  end if;

  tok := encode(gen_random_bytes(16), 'hex');
  insert into public.invites (token, target_type, target_id, created_by)
  values (tok, 'conversation', p_conversation, me);
  return tok;
end;
$$;

grant execute on function public.get_or_create_group_invite(uuid) to authenticated;

create or replace function public.reset_group_invite(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tok text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_conversation, me) then
    raise exception 'only admins can reset invite links';
  end if;

  update public.invites
  set revoked = true
  where target_type = 'conversation'
    and target_id = p_conversation
    and revoked = false;

  tok := encode(gen_random_bytes(16), 'hex');
  insert into public.invites (token, target_type, target_id, created_by)
  values (tok, 'conversation', p_conversation, me);
  return tok;
end;
$$;

grant execute on function public.reset_group_invite(uuid) to authenticated;

create or replace function public.revoke_group_invite(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_conversation, me) then
    raise exception 'only admins can revoke invite links';
  end if;

  update public.invites
  set revoked = true
  where target_type = 'conversation'
    and target_id = p_conversation
    and revoked = false;
end;
$$;

grant execute on function public.revoke_group_invite(uuid) to authenticated;

-- Override join_by_invite to honour approve_new_members for groups.
-- Drop first: return-type change cannot use CREATE OR REPLACE.
drop function if exists public.join_by_invite(text);

create or replace function public.join_by_invite(p_token text)
returns table (target_type text, target_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  me  uuid := auth.uid();
  needs_approval boolean := false;
  already boolean;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select * into inv from public.invites where token = p_token;
  if inv.token is null then raise exception 'invalid invite'; end if;
  if inv.revoked then raise exception 'invite revoked'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception 'invite expired';
  end if;
  if inv.max_uses is not null and inv.use_count >= inv.max_uses then
    raise exception 'invite fully used';
  end if;

  if inv.target_type = 'conversation' then
    select exists (
      select 1 from public.conversation_participants
      where conversation_id = inv.target_id and user_id = me
    ) into already;
    if already then
      return query select inv.target_type, inv.target_id, 'already_member'::text;
      return;
    end if;

    select coalesce(c.approve_new_members, false) into needs_approval
    from public.conversations c where c.id = inv.target_id;

    if needs_approval then
      insert into public.group_join_requests (conversation_id, user_id, status)
      values (inv.target_id, me, 'pending')
      on conflict (conversation_id, user_id) do update
        set status = 'pending', created_at = now(), resolved_at = null, resolved_by = null
        where public.group_join_requests.status <> 'pending';
      update public.invites set use_count = use_count + 1 where token = p_token;
      return query select inv.target_type, inv.target_id, 'pending'::text;
      return;
    end if;

    insert into public.conversation_participants (conversation_id, user_id, role)
    values (inv.target_id, me, 'member')
    on conflict (conversation_id, user_id) do nothing;

    perform public.post_system_message(
      inv.target_id,
      public._profile_label(me) || ' joined using an invite link'
    );
  elsif inv.target_type = 'community' then
    insert into public.community_members (community_id, user_id, role)
    values (inv.target_id, me, 'member')
    on conflict (community_id, user_id) do nothing;
  else
    raise exception 'unknown invite target';
  end if;

  update public.invites set use_count = use_count + 1 where token = p_token;
  return query select inv.target_type, inv.target_id, 'joined'::text;
end;
$$;

grant execute on function public.join_by_invite(text) to authenticated;

create or replace function public.list_group_join_requests(p_conversation uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_conversation) then
    raise exception 'only admins can view join requests';
  end if;
  return query
    select r.user_id, p.display_name, p.avatar_url, p.username, r.created_at
    from public.group_join_requests r
    join public.profiles p on p.id = r.user_id
    where r.conversation_id = p_conversation and r.status = 'pending'
    order by r.created_at;
end;
$$;

grant execute on function public.list_group_join_requests(uuid) to authenticated;

create or replace function public.resolve_group_join_request(
  p_conversation uuid,
  p_user_id      uuid,
  p_approve      boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_conversation, me) then
    raise exception 'only admins can resolve join requests';
  end if;

  update public.group_join_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      resolved_at = now(),
      resolved_by = me
  where conversation_id = p_conversation
    and user_id = p_user_id
    and status = 'pending';

  if not found then
    raise exception 'no pending request';
  end if;

  if p_approve then
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (p_conversation, p_user_id, 'member')
    on conflict (conversation_id, user_id) do nothing;
    perform public.post_system_message(
      p_conversation,
      public._profile_label(p_user_id) || ' was added to the group'
    );
  end if;
end;
$$;

grant execute on function public.resolve_group_join_request(uuid, uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) Pin / unpin messages
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pin_group_message(
  p_conversation uuid,
  p_message      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations%rowtype;
  me uuid := auth.uid();
  me_role text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.id is null then raise exception 'conversation not found'; end if;
  if not public.is_member(p_conversation) then raise exception 'not a member'; end if;

  me_role := public.group_member_role(p_conversation, me);
  if c.type = 'group' and c.only_admins_can_pin and me_role not in ('admin', 'super_admin') then
    raise exception 'only admins can pin messages';
  end if;

  if not exists (
    select 1 from public.messages
    where id = p_message and conversation_id = p_conversation and is_deleted = false
  ) then
    raise exception 'message not found in this conversation';
  end if;

  insert into public.conversation_pinned_messages (conversation_id, message_id, pinned_by)
  values (p_conversation, p_message, me)
  on conflict (conversation_id, message_id) do nothing;
end;
$$;

grant execute on function public.pin_group_message(uuid, uuid) to authenticated;

create or replace function public.unpin_group_message(
  p_conversation uuid,
  p_message      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations%rowtype;
  me_role text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.id is null then raise exception 'conversation not found'; end if;
  me_role := public.group_member_role(p_conversation);
  if c.type = 'group' and c.only_admins_can_pin and me_role not in ('admin', 'super_admin') then
    raise exception 'only admins can unpin messages';
  end if;
  delete from public.conversation_pinned_messages
  where conversation_id = p_conversation and message_id = p_message;
end;
$$;

grant execute on function public.unpin_group_message(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12) Disappearing messages: respect only_admins_manage_disappearing for groups
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_disappearing(conv uuid, secs int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations%rowtype;
  me_role text;
  v_old int;
  v_text text;
begin
  if not public.is_member(conv) then
    raise exception 'not a participant of this conversation';
  end if;
  if secs <> 0 and (secs < 3600 or secs > 28800) then
    raise exception 'duration must be 0 (off) or 3600..28800 seconds (1-8h)';
  end if;

  select * into c from public.conversations where id = conv;
  if c.id is null then
    raise exception 'conversation not found';
  end if;
  if c.type = 'group' and c.only_admins_manage_disappearing then
    me_role := public.group_member_role(conv);
    if me_role not in ('admin', 'super_admin') then
      raise exception 'only admins can manage disappearing messages';
    end if;
  end if;

  v_old := coalesce(c.disappear_seconds, 0);
  if v_old is not distinct from secs then
    return;
  end if;

  update public.conversations set disappear_seconds = secs where id = conv;

  -- System notice when value changes (from 0027).
  if secs = 0 then
    v_text := public._profile_label(auth.uid()) || ' turned off disappearing messages';
  else
    v_text := public._profile_label(auth.uid()) || ' turned on disappearing messages. New messages will disappear from this chat '
      || public._disappear_label(secs) || ' after they''re sent.';
  end if;
  perform public.post_system_message(conv, v_text);
end;
$$;

grant execute on function public.set_disappearing(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13) RLS: join requests, pins, participant admin updates, send permission
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "read join requests" on public.group_join_requests;
create policy "read join requests" on public.group_join_requests
  for select to authenticated using (
    public.is_group_admin(conversation_id)
    or user_id = auth.uid()
  );

drop policy if exists "create own join request" on public.group_join_requests;
create policy "create own join request" on public.group_join_requests
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "admin resolve join requests" on public.group_join_requests;
create policy "admin resolve join requests" on public.group_join_requests
  for update to authenticated using (public.is_group_admin(conversation_id));

drop policy if exists "read pinned messages" on public.conversation_pinned_messages;
create policy "read pinned messages" on public.conversation_pinned_messages
  for select to authenticated using (public.is_member(conversation_id));

-- Writes go through pin_group_message / unpin_group_message RPCs.

-- Admin may update participant roles only via RPCs (SECURITY DEFINER). Direct
-- client UPDATEs on roles are blocked to prevent privilege escalation.
drop policy if exists "update participant role" on public.conversation_participants;
-- no open UPDATE policy — role changes only via SECURITY DEFINER RPCs

-- Admins may remove other members via remove_group_member RPC; direct DELETE
-- remains self-leave only (0001 leave policy). Reinforced:
drop policy if exists "leave conversation" on public.conversation_participants;
create policy "leave conversation" on public.conversation_participants
  for delete to authenticated using (user_id = auth.uid());

-- Send messages: enforce only_admins_can_send for groups.
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_member(conversation_id)
    and (
      type = 'system'
      or not exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.type = 'group'
          and c.only_admins_can_send = true
      )
      or public.is_group_admin(conversation_id)
    )
  );

-- Message history visibility for new members: hide older messages when
-- member_history_visible is false and the reader joined after the message.
drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages
  for select to authenticated using (
    public.is_member(conversation_id)
    and (
      -- Always allow own messages / system messages after join is handled below
      not exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.type = 'group'
          and c.member_history_visible = false
      )
      or type = 'system'
      or created_at >= coalesce(
        (select joined_at from public.conversation_participants
         where conversation_id = messages.conversation_id and user_id = auth.uid()),
        '-infinity'::timestamptz
      )
    )
  );

-- Conversations: allow members to update only through RPCs (no broad UPDATE policy).
-- Keep select for members.
drop policy if exists "update group as admin" on public.conversations;
-- intentionally no direct UPDATE — all edits via SECURITY DEFINER RPCs

-- ─────────────────────────────────────────────────────────────────────────────
-- 14) Realtime + grants
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.group_join_requests;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.conversation_pinned_messages;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.invites;
exception when duplicate_object then null;
end $$;

grant execute on function public.is_group_admin(uuid, uuid) to authenticated;
grant execute on function public.is_group_super_admin(uuid, uuid) to authenticated;
grant execute on function public.group_member_role(uuid, uuid) to authenticated;
-- post_system_message intentionally NOT granted to authenticated (internal only).

-- Align delete_conversation_for_everyone with super_admin ownership.
create or replace function public.delete_conversation_for_everyone(
  p_conversation uuid
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_type       text;
  v_created_by uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select type, created_by into v_type, v_created_by
    from public.conversations where id = p_conversation;
  if v_type is null then raise exception 'conversation not found'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation and cp.user_id = auth.uid()
  ) then
    raise exception 'not authorized: not a participant';
  end if;

  if v_type = 'group' then
    if not public.is_group_super_admin(p_conversation) then
      raise exception 'not authorized: only the group owner can delete for everyone';
    end if;
  end if;

  delete from public.conversations where id = p_conversation;

  begin
    perform public._audit('delete_conversation_for_everyone', p_conversation::text,
                          jsonb_build_object('type', v_type));
  exception when others then null;
  end;
end; $$;

grant execute on function public.delete_conversation_for_everyone(uuid) to authenticated;
