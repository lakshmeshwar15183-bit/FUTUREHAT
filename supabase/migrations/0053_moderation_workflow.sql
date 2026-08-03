-- 0053_moderation_workflow.sql
-- Production moderation workflow:
--   • Richer report snapshots (type, message timestamp) so admins never need UUIDs
--   • admin_list_reports exposes full context for the dashboard
--   • admin_delete_message audits reason + report link + content snapshot
--   • admin_restore_message (best-effort from audit snapshot)
--   • admin_list_deleted_messages for "Recent Deleted Messages"
--   • Enhanced admin_global_search (UUID / user / username / email / phone / chat)
-- Idempotent; safe to re-run.

-- ── 1) Report snapshot columns ──────────────────────────────────────────────
alter table public.reports add column if not exists message_type text;
alter table public.reports add column if not exists message_created_at timestamptz;

-- ── 2) report_message — capture type + created_at ───────────────────────────
create or replace function public.report_message(
  p_message uuid,
  p_reason  text,
  p_details text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_conv   uuid;
  v_sender uuid;
  v_body   text;
  v_type   text;
  v_created timestamptz;
  v_id     uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_reason not in ('spam','harassment','abuse','fake_information',
                      'illegal_content','violence','child_safety','other') then
    raise exception 'invalid reason %', p_reason;
  end if;

  select m.conversation_id, m.sender_id, m.content, m.type, m.created_at
    into v_conv, v_sender, v_body, v_type, v_created
    from public.messages m where m.id = p_message;
  if v_conv is null then raise exception 'message not found'; end if;

  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_conv and cp.user_id = auth.uid()
  ) then raise exception 'not authorized to report this message'; end if;

  insert into public.reports (
    reporter_id, target_type, target_id, message_id, conversation_id,
    reported_user_id, reported_content, message_type, message_created_at,
    reason, details, status
  ) values (
    auth.uid(), 'message', p_message, p_message, v_conv,
    v_sender, v_body, v_type, v_created,
    p_reason, p_details, 'open'
  ) returning id into v_id;

  return v_id;
end; $$;

-- ── 3) admin_list_reports — full moderation context ─────────────────────────
create or replace function public.admin_list_reports(
  p_status text default null,
  p_limit  int  default 200
)
returns json language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_moderator_or_admin();
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        r.id                as report_id,
        r.target_type,
        r.target_id,
        r.message_id,
        r.conversation_id,
        r.conversation_id   as chat_id,
        r.reporter_id,
        coalesce(r.reported_user_id,
                 case when r.target_type = 'user' then r.target_id end) as reported_user_id,
        r.reason,
        r.details           as description,
        r.status,
        coalesce(r.escalated, false) as escalated,
        r.escalated_at,
        r.escalated_note,
        r.created_at,
        r.reviewed_at,
        r.reviewed_by,
        coalesce(m.content, r.reported_content) as message_content,
        coalesce(m.type, r.message_type, 'text') as message_type,
        coalesce(m.created_at, r.message_created_at) as message_created_at,
        m.media_url as message_media_url,
        (m.id is not null and coalesce(m.is_deleted,false) = false) as message_exists,
        rp.username     as reporter_username,
        rp.display_name as reporter_name,
        rp.avatar_url   as reporter_avatar,
        tp.username     as reported_username,
        tp.display_name as reported_name,
        tp.avatar_url   as reported_avatar,
        c.type          as conversation_type,
        c.name          as conversation_name,
        -- Human-readable conversation label: group name or DM peer(s)
        case
          when c.type = 'group' then coalesce(nullif(trim(c.name), ''), 'Group')
          else coalesce(
            (
              select string_agg(coalesce(nullif(p.display_name,''), nullif(p.username,''), left(p.id::text, 8)), ', ')
              from public.conversation_participants cp
              join public.profiles p on p.id = cp.user_id
              where cp.conversation_id = r.conversation_id
                and cp.user_id is distinct from r.reported_user_id
                and cp.user_id is distinct from r.reporter_id
              limit 3
            ),
            (
              select coalesce(nullif(p.display_name,''), nullif(p.username,''), left(p.id::text, 8))
              from public.conversation_participants cp
              join public.profiles p on p.id = cp.user_id
              where cp.conversation_id = r.conversation_id
                and cp.user_id is distinct from r.reported_user_id
              limit 1
            ),
            'Direct chat'
          )
        end as conversation_label
      from public.reports r
      left join public.messages  m  on m.id = r.message_id
      left join public.profiles  rp on rp.id = r.reporter_id
      left join public.profiles  tp on tp.id = coalesce(r.reported_user_id,
                 case when r.target_type = 'user' then r.target_id end)
      left join public.conversations c on c.id = r.conversation_id
      where (p_status is null or r.status = p_status)
      order by r.created_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) t
  ), '[]'::json);
end; $$;

-- ── 4) admin_delete_message — richer audit trail ────────────────────────────
-- Drop prior overloads so a single signature with defaults remains.
drop function if exists public.admin_delete_message(uuid);
drop function if exists public.admin_delete_message(uuid, text, uuid);

create or replace function public.admin_delete_message(
  msg uuid,
  p_reason text default null,
  p_report uuid default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_type text;
  v_content text;
  v_conv uuid;
  v_sender uuid;
begin
  perform public._require_moderator_or_admin();
  select type, content, conversation_id, sender_id
    into v_type, v_content, v_conv, v_sender
    from public.messages where id = msg;
  if not found then raise exception 'message not found'; end if;

  update public.messages
     set is_deleted = true, content = null, media_url = null
   where id = msg;

  perform public._audit(
    'delete_message',
    msg::text,
    jsonb_build_object(
      'reason', p_reason,
      'report_id', p_report,
      'type', v_type,
      'conversation_id', v_conv,
      'sender_id', v_sender,
      'content_snapshot', left(coalesce(v_content, ''), 500),
      'restorable', (v_content is not null and length(v_content) > 0)
    )
  );
end; $$;

-- ── 5) admin_restore_message — best-effort from last delete audit ───────────
create or replace function public.admin_restore_message(msg uuid)
returns json language plpgsql security definer set search_path = public
as $$
declare
  v_meta jsonb;
  v_snap text;
begin
  perform public._require_moderator_or_admin();
  select meta into v_meta
    from public.audit_log
   where action = 'delete_message' and target = msg::text
   order by created_at desc
   limit 1;

  if v_meta is null then
    raise exception 'no delete audit snapshot for this message';
  end if;

  v_snap := v_meta->>'content_snapshot';
  update public.messages
     set is_deleted = false,
         content = case
           when content is null and v_snap is not null and length(v_snap) > 0 then v_snap
           else content
         end
   where id = msg;

  if not found then raise exception 'message not found'; end if;

  perform public._audit('restore_message', msg::text, jsonb_build_object(
    'from_audit', true,
    'restored_content', (v_snap is not null and length(v_snap) > 0)
  ));

  return json_build_object(
    'ok', true,
    'message_id', msg,
    'content_restored', (v_snap is not null and length(v_snap) > 0)
  );
end; $$;

-- ── 6) admin_list_deleted_messages ──────────────────────────────────────────
create or replace function public.admin_list_deleted_messages(p_limit int default 100)
returns json language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_moderator_or_admin();
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        a.target as message_id,
        a.user_id as deleted_by,
        ap.display_name as deleted_by_name,
        ap.username as deleted_by_username,
        a.created_at as deleted_at,
        a.meta->>'reason' as reason,
        a.meta->>'report_id' as report_id,
        a.meta->>'type' as message_type,
        a.meta->>'conversation_id' as conversation_id,
        a.meta->>'sender_id' as sender_id,
        coalesce((a.meta->>'restorable')::boolean, false) as restorable,
        (m.id is not null) as message_row_exists,
        coalesce(m.is_deleted, true) as still_deleted
      from public.audit_log a
      left join public.profiles ap on ap.id = a.user_id
      left join public.messages m on m.id::text = a.target
      where a.action = 'delete_message'
      order by a.created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) t
  ), '[]'::json);
end; $$;

-- ── 7) Enhanced global search ───────────────────────────────────────────────
create or replace function public.admin_global_search(q text)
returns json language plpgsql stable security definer set search_path = public
as $$
declare
  v_raw text := trim(coalesce(q, ''));
  v_q   text := '%' || v_raw || '%';
  v_uuid uuid;
  v_is_uuid boolean := false;
begin
  perform public._require_admin();

  begin
    v_uuid := v_raw::uuid;
    v_is_uuid := true;
  exception when others then
    v_is_uuid := false;
  end;

  return json_build_object(
    'users', public.admin_search_users(v_raw),
    'communities', coalesce((select json_agg(row_to_json(c)) from (
        select id, name, description, owner_id, created_at from public.communities
        where name ilike v_q or coalesce(description,'') ilike v_q
           or (v_is_uuid and id = v_uuid)
        limit 25) c), '[]'::json),
    'channels', coalesce((select json_agg(row_to_json(c)) from (
        select id, name, kind, community_id from public.channels
        where name ilike v_q or (v_is_uuid and id = v_uuid)
        limit 25) c), '[]'::json),
    'messages', coalesce((select json_agg(row_to_json(m)) from (
        select id, conversation_id, sender_id, type, content, created_at, is_deleted
        from public.messages
        where (v_is_uuid and (id = v_uuid or conversation_id = v_uuid))
           or (not v_is_uuid and content ilike v_q and is_deleted = false)
        order by created_at desc
        limit 25) m), '[]'::json),
    'reports', coalesce((select json_agg(row_to_json(r)) from (
        select id, target_type, target_id, reason, status, created_at,
               message_id, conversation_id, reported_user_id
        from public.reports
        where reason ilike v_q
           or coalesce(details,'') ilike v_q
           or (v_is_uuid and (
                id = v_uuid
             or message_id = v_uuid
             or conversation_id = v_uuid
             or reporter_id = v_uuid
             or reported_user_id = v_uuid
             or target_id = v_uuid
           ))
        order by created_at desc
        limit 25) r), '[]'::json),
    'conversations', coalesce((select json_agg(row_to_json(cv)) from (
        select id, type, name, created_at from public.conversations
        where (v_is_uuid and id = v_uuid)
           or (not v_is_uuid and coalesce(name,'') ilike v_q)
        limit 25) cv), '[]'::json)
  );
end; $$;

-- ── 8) Grants ───────────────────────────────────────────────────────────────
grant execute on function public.report_message(uuid, text, text) to authenticated;
grant execute on function public.admin_list_reports(text, int) to authenticated;
grant execute on function public.admin_delete_message(uuid, text, uuid) to authenticated;
grant execute on function public.admin_restore_message(uuid) to authenticated;
grant execute on function public.admin_list_deleted_messages(int) to authenticated;
grant execute on function public.admin_global_search(text) to authenticated;
