-- 0061: Moderated message deletion keeps a visible tombstone (WhatsApp/Telegram).
-- User unsend → deleted_kind = 'user'
-- Admin/moderator remove → deleted_kind = 'moderation' (Lumixo Guidelines copy)

-- ── Column ──────────────────────────────────────────────────────────────────
alter table public.messages
  add column if not exists deleted_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_deleted_kind_check'
  ) then
    alter table public.messages
      add constraint messages_deleted_kind_check
      check (deleted_kind is null or deleted_kind in ('user', 'moderation'));
  end if;
end $$;

comment on column public.messages.deleted_kind is
  'When is_deleted: user = sender unsend tombstone; moderation = removed by Lumixo.';

-- Backfill: any soft-deleted row without a kind was almost always user unsend.
update public.messages
   set deleted_kind = 'user'
 where is_deleted = true
   and deleted_kind is null;

-- ── Admin delete: mark moderation + clear body (audit keeps snapshot) ───────
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
  v_media text;
  v_conv uuid;
  v_sender uuid;
  v_meta jsonb;
begin
  perform public._require_moderator_or_admin();
  select type, content, media_url, conversation_id, sender_id, media_meta
    into v_type, v_content, v_media, v_conv, v_sender, v_meta
    from public.messages where id = msg;
  if not found then raise exception 'message not found'; end if;

  -- Soft-delete for everyone; keep the row so timeline position is stable.
  update public.messages
     set is_deleted = true,
         deleted_kind = 'moderation',
         content = null,
         media_url = null,
         media_meta = '{}'::jsonb
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
      'deletion_kind', 'moderation',
      'content_snapshot', left(coalesce(v_content, ''), 2000),
      'media_url_snapshot', left(coalesce(v_media, ''), 500),
      'media_meta_snapshot', v_meta,
      'restorable', true
    )
  );
end; $$;

-- ── Restore clears moderation kind ──────────────────────────────────────────
create or replace function public.admin_restore_message(msg uuid)
returns json language plpgsql security definer set search_path = public
as $$
declare
  v_meta jsonb;
  v_snap text;
  v_media text;
  v_media_meta jsonb;
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
  v_media := v_meta->>'media_url_snapshot';
  begin
    v_media_meta := (v_meta->'media_meta_snapshot');
  exception when others then
    v_media_meta := null;
  end;

  update public.messages
     set is_deleted = false,
         deleted_kind = null,
         content = case
           when content is null and v_snap is not null and length(v_snap) > 0 then v_snap
           else content
         end,
         media_url = case
           when media_url is null and v_media is not null and length(v_media) > 0 then v_media
           else media_url
         end,
         media_meta = coalesce(v_media_meta, media_meta, '{}'::jsonb)
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

grant execute on function public.admin_delete_message(uuid, text, uuid) to authenticated;
grant execute on function public.admin_restore_message(uuid) to authenticated;

-- ── Clients cannot forge moderation tombstones ──────────────────────────────
create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.type is distinct from new.type then
    raise exception 'message type cannot be changed';
  end if;
  if old.sender_id is distinct from new.sender_id then
    raise exception 'sender cannot be changed';
  end if;
  if old.conversation_id is distinct from new.conversation_id then
    raise exception 'conversation cannot be changed';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'created_at cannot be changed';
  end if;

  -- Only moderators/admins may set deleted_kind = moderation (or clear it via restore RPC).
  if new.deleted_kind is distinct from old.deleted_kind then
    if new.deleted_kind = 'moderation'
       or (old.deleted_kind = 'moderation' and new.deleted_kind is null) then
      perform public._require_moderator_or_admin();
    end if;
  end if;

  if old.type = 'system'
     and current_setting('app.allow_system_msg', true) is distinct from 'on' then
    if old.content is distinct from new.content
       or old.media_url is distinct from new.media_url
       or old.is_deleted is distinct from new.is_deleted
       or old.reply_to is distinct from new.reply_to
       or old.edited_at is distinct from new.edited_at
       or old.media_meta is distinct from new.media_meta
       or old.expires_at is distinct from new.expires_at
       or old.is_forwarded is distinct from new.is_forwarded
       or old.deleted_kind is distinct from new.deleted_kind
    then
      raise exception 'system messages are immutable';
    end if;
  end if;

  if new.content is not null and length(new.content) > 16000 then
    raise exception 'message too long';
  end if;

  return new;
end;
$$;
