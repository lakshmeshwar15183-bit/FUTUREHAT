-- 0022_disappearing_messages.sql
-- WhatsApp-style disappearing messages (per conversation).
-- • conversations.disappear_seconds: 0 = OFF (default), else 3600..28800 (1–8h).
-- • messages.expires_at: stamped automatically at INSERT from the conversation's
--   current setting, so every message carries its OWN expiry snapshot (changing
--   the timer later never retroactively re-times old messages — WhatsApp parity).
-- • set_disappearing(conv, secs): member-only RPC to toggle / change the timer.
-- • purge_expired_messages(): opportunistic physical cleanup, scoped to the
--   caller's own conversations. Clients also hide expired messages immediately.
-- Backward compatible: existing rows get disappear_seconds=0 and expires_at=NULL,
-- i.e. nothing disappears until a user turns it on.

-- ── Schema ───────────────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists disappear_seconds int not null default 0;

-- 0 (off) or a 1–8 hour window, in seconds.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_disappear_seconds_chk'
  ) then
    alter table public.conversations
      add constraint conversations_disappear_seconds_chk
      check (disappear_seconds = 0 or (disappear_seconds between 3600 and 28800));
  end if;
end $$;

alter table public.messages
  add column if not exists expires_at timestamptz;

-- Partial index keeps the purge / expiry-filter cheap.
create index if not exists idx_messages_expires_at
  on public.messages(expires_at) where expires_at is not null;

-- ── Stamp expiry on insert ───────────────────────────────────────────────────
create or replace function public.set_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secs int;
begin
  -- Only stamp when the client didn't already provide one (keeps it idempotent).
  if new.expires_at is null then
    select disappear_seconds into secs
      from public.conversations where id = new.conversation_id;
    if secs is not null and secs > 0 then
      new.expires_at := now() + make_interval(secs => secs);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_message_expiry on public.messages;
create trigger trg_set_message_expiry
  before insert on public.messages
  for each row execute function public.set_message_expiry();

-- ── Toggle / change the timer (member-only) ──────────────────────────────────
create or replace function public.set_disappearing(conv uuid, secs int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(conv) then
    raise exception 'not a participant of this conversation';
  end if;
  if secs <> 0 and (secs < 3600 or secs > 28800) then
    raise exception 'duration must be 0 (off) or 3600..28800 seconds (1-8h)';
  end if;
  update public.conversations set disappear_seconds = secs where id = conv;
end $$;

grant execute on function public.set_disappearing(uuid, int) to authenticated;

-- ── Opportunistic physical cleanup (caller's conversations only) ─────────────
create or replace function public.purge_expired_messages()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.messages m
    using public.conversation_participants p
   where m.expires_at is not null
     and m.expires_at <= now()
     and p.conversation_id = m.conversation_id
     and p.user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.purge_expired_messages() to authenticated;
