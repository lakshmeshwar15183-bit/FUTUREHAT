-- 0030_media_extras.sql — media metadata + View Once for the new media workflow.
-- ============================================================================
-- ADDITIVE ONLY + idempotent. Backward-compatible: existing media messages keep
-- working (media_meta defaults to '{}'). No message type change (videos still
-- ride as image/file + media_url, exactly as today).
--
--   • messages.media_meta jsonb — carries per-attachment metadata the new picker/
--     editor produces: { viewOnce, hd, quality, width, height, durationMs, edited }.
--     Nullable-safe via default '{}'. Old rows read as '{}'.
--   • message_view_once_views — records the ONE allowed view per recipient of a
--     View-Once message (server-authoritative; the client cannot re-open it).
--   • mark_view_once_seen(msg) — idempotent RPC a recipient calls when they open a
--     View-Once item; the FIRST call records the view, later calls report consumed.
--   • view_once_state(msg) — lets a client know, authoritatively, whether it may
--     still open a View-Once message (sender always may re-see nothing; recipient
--     gets exactly one open).
-- Reuses is_member() (0001). Apply after 0029. Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) MEDIA METADATA COLUMN
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.messages
  add column if not exists media_meta jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) VIEW-ONCE VIEW LEDGER  (one open per recipient; own-rows insert)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.message_view_once_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  viewer_id  uuid not null references auth.users(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (message_id, viewer_id)
);
alter table public.message_view_once_views enable row level security;

-- A member of the message's conversation can see view rows (so the SENDER can tell
-- it was opened); a user can only record THEIR OWN view.
drop policy if exists "read view-once views" on public.message_view_once_views;
create policy "read view-once views" on public.message_view_once_views
  for select to authenticated using (
    public.is_member((select conversation_id from public.messages m where m.id = message_id)));

drop policy if exists "insert own view-once view" on public.message_view_once_views;
create policy "insert own view-once view" on public.message_view_once_views
  for insert to authenticated with check (
    viewer_id = auth.uid()
    and public.is_member((select conversation_id from public.messages m where m.id = message_id)));

grant select, insert on public.message_view_once_views to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPC: mark a View-Once message as seen (idempotent, server-authoritative)
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns json { first_view: bool, consumed: bool }. The FIRST caller (a recipient
-- who is NOT the sender) records the view and gets first_view=true. Any later call
-- (or the sender) gets first_view=false, consumed=true. The sender opening their own
-- View-Once never consumes it.
create or replace function public.mark_view_once_seen(p_message uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_sender uuid;
  v_conv uuid;
  v_is_vo boolean;
  v_first boolean := false;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select sender_id, conversation_id, coalesce((media_meta->>'viewOnce')::boolean, false)
    into v_sender, v_conv, v_is_vo
  from public.messages where id = p_message;
  if v_conv is null then raise exception 'message not found'; end if;
  if not public.is_member(v_conv) then raise exception 'not a member'; end if;
  if not v_is_vo then
    return json_build_object('first_view', false, 'consumed', false, 'view_once', false);
  end if;
  -- The sender viewing their own message never consumes it.
  if v_me = v_sender then
    return json_build_object('first_view', false, 'consumed', true, 'view_once', true, 'is_sender', true);
  end if;
  insert into public.message_view_once_views (message_id, viewer_id)
  values (p_message, v_me)
  on conflict (message_id, viewer_id) do nothing;
  get diagnostics v_first = row_count;   -- 1 if this call inserted (first open)
  return json_build_object('first_view', v_first > 0, 'consumed', true, 'view_once', true);
end $$;

-- Read-only: may THIS user still open the View-Once message? (does not consume)
create or replace function public.view_once_state(p_message uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_sender uuid; v_conv uuid; v_is_vo boolean; v_seen boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select sender_id, conversation_id, coalesce((media_meta->>'viewOnce')::boolean, false)
    into v_sender, v_conv, v_is_vo
  from public.messages where id = p_message;
  if v_conv is null then raise exception 'message not found'; end if;
  if not public.is_member(v_conv) then raise exception 'not a member'; end if;
  select exists(select 1 from public.message_view_once_views
                where message_id = p_message and viewer_id = v_me) into v_seen;
  return json_build_object(
    'view_once', v_is_vo,
    'is_sender', v_me = v_sender,
    'seen', v_seen,
    'can_open', v_is_vo and (v_me = v_sender or not v_seen)
  );
end $$;

grant execute on function public.mark_view_once_seen(uuid) to authenticated;
grant execute on function public.view_once_state(uuid)     to authenticated;
