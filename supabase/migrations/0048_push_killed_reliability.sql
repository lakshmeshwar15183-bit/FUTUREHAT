-- 0048_push_killed_reliability.sql
-- P0: allow FCM fan-out to retry after a failed claim (no tokens / FCM error).
-- Without release_push_dedupe, claim_push_dedupe permanently swallows events
-- when the first attempt delivers zero messages — classic killed-app silence.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Release a dedupe claim so outbox / later sendPush can retry
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.release_push_dedupe(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_key), '') = '' then
    return false;
  end if;
  delete from public.push_sent_dedupe where key = p_key;
  return found;
end;
$$;

grant execute on function public.release_push_dedupe(text) to service_role;
grant execute on function public.release_push_dedupe(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Ops helper: count pending outbox (for health / cron monitoring)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.push_outbox_pending_count()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int
  from public.push_outbox
  where delivered_at is null
    and attempts < 12;
$$;

grant execute on function public.push_outbox_pending_count() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Notes for always-on drain (cannot embed secrets in SQL safely)
-- ─────────────────────────────────────────────────────────────────────────────
-- Required ops (WhatsApp-class killed delivery without a live sender client):
--   Schedule every 1 minute (Supabase Dashboard → Edge Functions → Schedules
--   or external cron):
--     POST https://<project>.supabase.co/functions/v1/push
--     Authorization: Bearer <SERVICE_ROLE_KEY>
--     Body: {"drainOutbox":true,"limit":100}
-- See scripts/setup-ops-crons.sh
--
-- Optional: if the `pg_net` extension is enabled and you store the service role
-- in Vault, you can add a Database Webhook on push_outbox INSERT → Edge Function.
-- That is project-specific and is intentionally not auto-wired here.
