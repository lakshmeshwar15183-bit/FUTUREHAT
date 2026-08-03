-- 0047_push_token_touch.sql
-- Touch updated_at on every re-register so ops can prune dead tokens.

alter table public.device_push_tokens
  add column if not exists app_version text;

create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_token),'') = '' then return; end if;
  insert into public.device_push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform,'android'), now())
  on conflict (token) do update
    set user_id = auth.uid(),
        platform = excluded.platform,
        updated_at = now();
end; $$;

-- Prune tokens not seen in 90 days (call from cron / service role).
create or replace function public.prune_stale_push_tokens(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.device_push_tokens
  where updated_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 14));
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.prune_stale_push_tokens(int) to service_role;
