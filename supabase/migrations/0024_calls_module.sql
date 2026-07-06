-- 0024_calls_module.sql — WhatsApp-style Calls module (history + delete + schedule).
-- ============================================================================
-- ADDITIVE ONLY + idempotent. The WebRTC calling stack (0006 `calls` table +
-- realtime) is untouched. This adds the call-HISTORY surround both apps need:
--   • call_log_deletions — per-user "delete for me" for call logs (mirrors
--     deleted_conversations, 0016). Deleting/clearing only hides rows for the
--     caller; the peer keeps their history. Never touches conversations/messages.
--   • get_call_history() — resolves, per call and RELATIVE TO THE VIEWER, the
--     peer (the other 1:1 participant) + direction, and drops per-user-deleted
--     rows. Fixes the old bug where outgoing calls showed yourself. Paginated.
--   • delete_call_logs() / clear_call_log() — per-user hide of some / all logs.
--   • scheduled_calls — schedule a voice/video call with a contact (mirrors
--     scheduled_messages, 0008), member-readable, organizer-managed, on realtime.
-- Reuses public.is_member() (0001). Apply after 0023. Safe to re-run.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) PER-USER CALL-LOG DELETIONS  (free; own-rows only — mirrors 0016)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.call_log_deletions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  call_id    uuid not null references public.calls(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (user_id, call_id)
);
alter table public.call_log_deletions enable row level security;

drop policy if exists "read own call deletions"   on public.call_log_deletions;
create policy "read own call deletions" on public.call_log_deletions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own call deletions" on public.call_log_deletions;
create policy "insert own call deletions" on public.call_log_deletions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "delete own call deletions" on public.call_log_deletions;
create policy "delete own call deletions" on public.call_log_deletions
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, delete on public.call_log_deletions to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) SCHEDULED CALLS  (mirrors scheduled_messages; member read, organizer manage)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.scheduled_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  organizer_id    uuid not null references auth.users(id) on delete cascade,
  callee_id       uuid references auth.users(id) on delete set null,
  type            text not null default 'audio' check (type in ('audio','video')),
  scheduled_at    timestamptz not null,
  title           text,
  status          text not null default 'scheduled' check (status in ('scheduled','cancelled','done')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_scheduled_calls_org  on public.scheduled_calls(organizer_id, scheduled_at);
create index if not exists idx_scheduled_calls_conv on public.scheduled_calls(conversation_id);
alter table public.scheduled_calls enable row level security;

-- A member of the conversation can see the scheduled call (so the callee sees it too).
drop policy if exists "read scheduled calls" on public.scheduled_calls;
create policy "read scheduled calls" on public.scheduled_calls
  for select to authenticated using (public.is_member(conversation_id));
-- Only the organizer creates / cancels / edits their own scheduled calls.
drop policy if exists "insert own scheduled calls" on public.scheduled_calls;
create policy "insert own scheduled calls" on public.scheduled_calls
  for insert to authenticated
  with check (organizer_id = auth.uid() and public.is_member(conversation_id));
drop policy if exists "update own scheduled calls" on public.scheduled_calls;
create policy "update own scheduled calls" on public.scheduled_calls
  for update to authenticated using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());
drop policy if exists "delete own scheduled calls" on public.scheduled_calls;
create policy "delete own scheduled calls" on public.scheduled_calls
  for delete to authenticated using (organizer_id = auth.uid());

grant select, insert, update, delete on public.scheduled_calls to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CALL HISTORY  (viewer-relative peer + direction; excludes deleted; paginated)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_call_history(
  p_limit  int         default 100,
  p_before timestamptz default null
)
returns json language plpgsql stable security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select json_agg(row_to_json(t)) from (
      select
        c.id, c.conversation_id, c.type, c.status,
        c.started_at, c.answered_at, c.ended_at, c.caller_id,
        case when c.caller_id = v_me then 'outgoing' else 'incoming' end as direction,
        conv.type as conversation_type,
        conv.name as conversation_name,
        peer.user_id     as peer_id,
        pp.username      as peer_username,
        pp.display_name  as peer_name,
        pp.avatar_url    as peer_avatar
      from public.calls c
      join public.conversations conv on conv.id = c.conversation_id
      -- lateral: the single "other" participant for a 1:1 (null for groups)
      left join lateral (
        select cp.user_id from public.conversation_participants cp
        where cp.conversation_id = c.conversation_id and cp.user_id <> v_me
        limit 1
      ) peer on conv.type <> 'group'
      left join public.profiles pp on pp.id = peer.user_id
      -- viewer must be a member and must not have hidden this call
      where public.is_member(c.conversation_id)
        and not exists (
          select 1 from public.call_log_deletions d
          where d.call_id = c.id and d.user_id = v_me)
        and (p_before is null or c.started_at < p_before)
      order by c.started_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 200))
    ) t
  ), '[]'::json);
end; $$;

-- Hide specific call logs for the caller only (delete-for-me). is_member() takes
-- a conversation id, so a user can only hide calls in conversations they belong to.
create or replace function public.delete_call_logs(p_ids uuid[])
returns void language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.call_log_deletions (user_id, call_id)
  select v_me, c.id
  from public.calls c
  where c.id = any(p_ids) and public.is_member(c.conversation_id)
  on conflict do nothing;
end; $$;

-- Clear the caller's entire call history (hide every currently-visible call).
create or replace function public.clear_call_log()
returns void language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.call_log_deletions (user_id, call_id)
  select v_me, c.id
  from public.calls c
  where public.is_member(c.conversation_id)
    and not exists (
      select 1 from public.call_log_deletions d
      where d.call_id = c.id and d.user_id = v_me)
  on conflict do nothing;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.get_call_history(int, timestamptz) to authenticated;
grant execute on function public.delete_call_logs(uuid[])           to authenticated;
grant execute on function public.clear_call_log()                   to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) REALTIME  (calls already published in 0006; add the two new tables so
--    delete-for-me syncs across the user's devices and scheduled calls go live)
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='call_log_deletions') then
    alter publication supabase_realtime add table public.call_log_deletions;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='scheduled_calls') then
    alter publication supabase_realtime add table public.scheduled_calls;
  end if;
end $$;
