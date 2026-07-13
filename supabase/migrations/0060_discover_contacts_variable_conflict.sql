-- 0060: resolve PL/pgSQL #variable_conflict for discover_contacts OUT params.

create or replace function public.discover_contacts(p_hashes text[])
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  about text,
  phone_hash text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  cleaned text[];
  cnt int;
  win_start timestamptz;
  req_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  cleaned := array(
    select distinct lower(h)
    from unnest(coalesce(p_hashes, '{}'::text[])) as h
    where h ~ '^[0-9a-fA-F]{64}$'
    limit 500
  );
  cnt := coalesce(cardinality(cleaned), 0);
  if cnt = 0 then
    return;
  end if;

  insert into public.contact_discovery_rate (user_id, window_start, request_count, last_request_at)
  values (v_uid, now(), 1, now())
  on conflict (user_id) do update
  set
    window_start = case
      when contact_discovery_rate.window_start < now() - interval '1 hour' then now()
      else contact_discovery_rate.window_start
    end,
    request_count = case
      when contact_discovery_rate.window_start < now() - interval '1 hour' then 1
      else contact_discovery_rate.request_count + 1
    end,
    last_request_at = now()
  returning contact_discovery_rate.window_start, contact_discovery_rate.request_count
  into win_start, req_count;

  if req_count > 40 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.about,
    p.phone_hash
  from public.profiles p
  where p.phone_hash = any (cleaned)
    and p.id <> v_uid
    and p.deleted_at is null
    and coalesce(p.account_status, 'active') not in ('banned', 'disabled')
  limit 200;
end;
$$;

revoke all on function public.discover_contacts(text[]) from public;
grant execute on function public.discover_contacts(text[]) to authenticated;
