-- 0068: BETA-ONLY email provider allowlist (temporary anti-spam gate).
-- Client mirror: shared/allowedEmailDomains.ts (same list, same message).
-- Hard server gate on auth.users — cannot be bypassed by any client.
--
-- Scope: blocks INSERT (signup) and email UPDATE for non-allowlisted domains.
-- Existing accounts, login, and password reset are unaffected (no email write).
-- Runs BEFORE the 0066 disposable check conceptually; both triggers coexist —
-- allowlist is strictly tighter, disposable block stays as defense in depth
-- for when the allowlist is retired.
--
-- ROLLBACK (when beta ends), run:
--   drop trigger if exists trg_allowed_email_domain_ins on auth.users;
--   drop trigger if exists trg_allowed_email_domain_upd on auth.users;
--   drop function if exists public.enforce_allowed_email_domain();
--   drop function if exists public.is_allowed_email_domain(text);
--   drop table if exists public.allowed_email_domains;
-- ...and remove the isAllowedEmailDomain() checks in shared/ (see file comment).
-- Future replacements (MX validation, Turnstile, reputation scoring) slot into
-- the same place: a BEFORE trigger / auth hook on auth.users, plus the client
-- pre-check in shared/authApi.ts.

create table if not exists public.allowed_email_domains (
  domain text primary key
);

comment on table public.allowed_email_domains is
  'BETA: trusted email providers allowed to sign up. Temporary; see 0068 header for rollback.';

insert into public.allowed_email_domains (domain) values
  -- Google
  ('gmail.com'),
  ('googlemail.com'),
  -- Microsoft
  ('outlook.com'),
  ('hotmail.com'),
  ('live.com'),
  ('msn.com'),
  -- Apple
  ('icloud.com'),
  ('me.com'),
  ('mac.com'),
  -- Yahoo
  ('yahoo.com'),
  ('yahoo.co.in'),
  ('ymail.com'),
  -- Proton
  ('proton.me'),
  ('protonmail.com'),
  -- Zoho
  ('zoho.com'),
  ('zohomail.com'),
  -- AOL
  ('aol.com'),
  -- GMX
  ('gmx.com'),
  ('gmx.net'),
  -- Mail.com
  ('mail.com'),
  -- Fastmail
  ('fastmail.com'),
  ('fastmail.fm'),
  -- Tuta
  ('tuta.com'),
  ('tutanota.com'),
  -- Yandex
  ('yandex.com'),
  ('yandex.ru'),
  -- Mail.ru
  ('mail.ru'),
  -- Tencent
  ('qq.com'),
  -- NetEase
  ('163.com'),
  ('126.com'),
  -- Naver
  ('naver.com'),
  -- India ISPs / portals
  ('rediffmail.com'),
  ('indiatimes.com'),
  -- UK / North America ISPs
  ('btinternet.com'),
  ('comcast.net'),
  ('verizon.net'),
  ('att.net'),
  ('cox.net'),
  ('charter.net'),
  ('bellsouth.net'),
  ('shaw.ca'),
  ('rogers.com'),
  ('telus.net'),
  ('virginmedia.com')
on conflict (domain) do nothing;

-- True when the email's domain is on the beta allowlist.
-- Trims whitespace, lowercases, exact-match only (no subdomain spoofing).
create or replace function public.is_allowed_email_domain(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_domain text;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) < 2 then
    return false;
  end if;

  v_domain := split_part(v_email, '@', 2);
  if v_domain = '' then
    return false;
  end if;

  return exists (
    select 1 from public.allowed_email_domains a where a.domain = v_domain
  );
end;
$$;

revoke all on function public.is_allowed_email_domain(text) from public;
grant execute on function public.is_allowed_email_domain(text) to authenticated, anon, service_role;

-- Reject non-allowlisted emails on auth.users insert / email change.
create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_allowed_email_domain(new.email) then
    raise exception 'email_domain_not_allowed'
      using errcode = 'P0001',
            hint = 'Lumixo is in beta. Sign up with a supported email provider.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_allowed_email_domain_ins on auth.users;
create trigger trg_allowed_email_domain_ins
  before insert on auth.users
  for each row
  execute function public.enforce_allowed_email_domain();

drop trigger if exists trg_allowed_email_domain_upd on auth.users;
create trigger trg_allowed_email_domain_upd
  before update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.enforce_allowed_email_domain();

-- Lock the table down; function is security definer, no public read needed.
alter table public.allowed_email_domains enable row level security;
grant select, insert, delete on public.allowed_email_domains to service_role;
