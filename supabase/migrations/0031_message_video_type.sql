-- 0031_message_video_type.sql — make `video` a first-class message type.
-- ============================================================================
-- ADDITIVE + idempotent + backward-compatible. Until now videos rode as
-- type='file' + a video media_url and were re-detected everywhere by a filename
-- extension regex (see 0030's note: "videos still ride as image/file"). This
-- promotes video to a real message type so the client can render/label/gate it
-- as video without extension sniffing.
--
--   1) widen messages_type_check to allow 'video' (precedent: 0027).
--   2) backfill existing file+video-url rows to type='video' (idempotent).
--   3) keep 'video' counting toward relationship streaks (0029 media clause).
--
-- Apply after 0030. Safe to re-run. Must be applied BEFORE shipping clients that
-- send type='video', or those inserts fail the CHECK constraint.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ALLOW 'video' IN messages.type
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text','image','file','audio','system','video'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) BACKFILL: old videos were stored as type='file' with a video media_url.
--    Promote them so historical chats become first-class too. Idempotent — a
--    second run matches nothing (those rows are already 'video').
-- ─────────────────────────────────────────────────────────────────────────────
update public.messages
  set type = 'video'
  where type = 'file'
    and coalesce(media_url, '') <> ''
    and media_url ~* '\.(mp4|webm|mov|m4v|ogv|ogg)($|\?|#)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) STREAKS: keep a sent video qualifying for the daily streak. This is an
--    exact copy of the 0029 function with the media clause widened from
--    ('image','file') to ('image','file','video') so backfilled + new video
--    messages still count (they did as 'file' before).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._streak_user_qualified(p_conv uuid, p_user uuid, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.messages m
      where m.conversation_id = p_conv
        and m.sender_id = p_user
        and coalesce(m.is_deleted, false) = false
        and (m.created_at at time zone 'utc')::date = p_day
        and (
          (m.type = 'text' and public._streak_word_count(m.content) >= 5)
          or (m.type in ('image','file','video') and coalesce(m.media_url, '') <> '')
        )
    )
    or exists (
      select 1 from public.calls c
      where c.conversation_id = p_conv
        and c.status = 'ended'
        and c.answered_at is not null
        and c.ended_at is not null
        and (c.ended_at - c.answered_at) > interval '15 seconds'
        and (c.answered_at at time zone 'utc')::date = p_day
    );
$$;
