-- 0027_chat_lock_and_system_messages.sql
-- ============================================================================
-- THREE independent, additive changes (idempotent, safe to re-run):
--
--  1) SYSTEM MESSAGES ('system' message type) — WhatsApp-style in-conversation
--     info notices. The messages.type CHECK is widened to allow 'system'. The
--     disappearing-messages RPC now inserts ONE system message whenever the timer
--     is turned on / off / changed, so both participants see a persistent notice.
--     System messages never disappear (the expiry trigger skips them) and are not
--     user-editable/deletable (enforced in the clients).
--
--  2) CHAT LOCK — per-user, per-conversation lock list (`locked_conversations`),
--     mirroring pinned_conversations. The actual authentication is done on-device
--     (biometric / device PIN via the OS secure APIs); NO secret is ever stored
--     here — this table only records WHICH conversations the user chose to lock,
--     so the choice syncs across their devices.
--
--  3) REMOVE "HIDE PRIVATE CHATS" — the premium hide feature is retired; its table
--     `hidden_conversations` (0003) is dropped. Archive (archived_conversations,
--     0010) and delete-for-me (deleted_conversations, 0016) are SEPARATE tables and
--     are left completely untouched.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) SYSTEM MESSAGE TYPE
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text','image','file','audio','system'));

-- Expiry trigger: never stamp an expiry on a system message (they must persist,
-- exactly like WhatsApp system notices). Otherwise unchanged from 0022.
create or replace function public.set_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secs int;
begin
  if new.type = 'system' then
    new.expires_at := null;          -- system notices never disappear
    return new;
  end if;
  if new.expires_at is null then
    select disappear_seconds into secs
      from public.conversations where id = new.conversation_id;
    if secs is not null and secs > 0 then
      new.expires_at := now() + make_interval(secs => secs);
    end if;
  end if;
  return new;
end $$;

-- Human label for a disappearing duration in whole hours (UI only offers 1–8h).
create or replace function public._disappear_label(secs int)
returns text language sql immutable set search_path = public
as $$
  select case
    when secs is null or secs <= 0 then 'off'
    when secs = 3600 then '1 hour'
    when secs % 3600 = 0 then (secs / 3600)::text || ' hours'
    else round(secs / 3600.0, 1)::text || ' hours'
  end;
$$;

-- set_disappearing now also posts ONE system message when the value actually
-- changes (turn on / off / change duration), so it appears once for BOTH members
-- and persists in history. Member-gated exactly as before.
create or replace function public.set_disappearing(conv uuid, secs int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old int;
  v_text text;
begin
  if not public.is_member(conv) then
    raise exception 'not a participant of this conversation';
  end if;
  if secs <> 0 and (secs < 3600 or secs > 28800) then
    raise exception 'duration must be 0 (off) or 3600..28800 seconds (1-8h)';
  end if;

  select disappear_seconds into v_old from public.conversations where id = conv;
  if coalesce(v_old, 0) = secs then
    return;                          -- no change ⇒ no system message (exactly once)
  end if;

  update public.conversations set disappear_seconds = secs where id = conv;

  v_text := case
    when secs = 0 then 'Disappearing messages are off.'
    else 'Disappearing messages are on. New messages will disappear after '
         || public._disappear_label(secs) || '.'
  end;

  insert into public.messages (conversation_id, sender_id, type, content)
  values (conv, auth.uid(), 'system', v_text);
end $$;

grant execute on function public.set_disappearing(uuid, int)  to authenticated;
grant execute on function public._disappear_label(int)        to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) CHAT LOCK — locked_conversations (per-user choice; no secret stored here)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.locked_conversations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  locked_at       timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.locked_conversations enable row level security;

-- Own-rows only. Locking is a security feature available to every user (unlike the
-- retired premium "hide"), so there is NO premium gate here.
drop policy if exists "manage own locks" on public.locked_conversations;
create policy "manage own locks" on public.locked_conversations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) REMOVE "HIDE PRIVATE CHATS" — drop the retired premium hide table.
--    archived_conversations (0010) + deleted_conversations (0016) are untouched.
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists public.hidden_conversations cascade;
