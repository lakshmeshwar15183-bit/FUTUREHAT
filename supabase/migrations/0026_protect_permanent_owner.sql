-- 0026_protect_permanent_owner.sql — Absolute protection for the permanent owner.
-- ============================================================================
-- WHAT THIS DOES
--   FUTUREHAT has exactly ONE permanent OWNER = the immutable developer allowlist
--   (is_developer / is_owner, 0005 + 0013). That account can never be assigned,
--   transferred, demoted, or moderated through the app.
--
--   The destructive user-management RPCs (0013 + 0025) already refuse to let a
--   NON-owner touch an owner account via _guard_owner_target(). The remaining gap:
--   the OWNER itself (or a forged/manipulated request that somehow passes the
--   admin gate) could still ban / suspend / disable / lock / force-logout / delete
--   / demote / un-verify / revoke-premium the owner account — i.e. destroy the
--   single permanent admin. This migration closes that gap ABSOLUTELY.
--
--   New guard _guard_protect_owner(target): raises for ANY caller (owner included)
--   whenever the target is an owner account. It is added to every destructive /
--   account-mutating RPC. The owner account therefore cannot be banned, suspended,
--   disabled, locked, force-logged-out, deleted, demoted, role-changed, un-verified
--   or premium-revoked through any API / RPC / manipulated-frontend request.
--
--   Normal user management is UNCHANGED — the guard only fires on owner targets,
--   which no real user other than the developer can ever be.
--
-- ADDITIVE + idempotent. CREATE OR REPLACE only; no data changes. Apply after 0025.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ABSOLUTE OWNER-TARGET GUARD  (rejects every caller, owner included)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._guard_protect_owner(p_target uuid)
returns void language plpgsql stable security definer set search_path = public
as $$ begin
  if public.is_owner(p_target) then
    raise exception 'not authorized: the permanent owner account is protected and cannot be modified';
  end if;
end; $$;
grant execute on function public._guard_protect_owner(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RE-CREATE DESTRUCTIVE RPCs WITH THE ABSOLUTE OWNER GUARD
--    Bodies are reproduced faithfully from 0013 (and admin_set_role from 0025);
--    the ONLY addition is the _guard_protect_owner(target) call up front.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ban / suspend / restore / unban / disable / lock.
create or replace function public.admin_set_account_status(
  target uuid, new_status text, reason text default null, until timestamptz default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner account is immutable
  if new_status not in ('active','suspended','banned','disabled','locked') then
    raise exception 'invalid status %', new_status;
  end if;
  select account_status into v_old from public.profiles where id = target;
  update public.profiles set
    account_status  = new_status,
    status_reason   = reason,
    suspended_until = case when new_status = 'suspended' then until else null end,
    banned_at       = case when new_status = 'banned' then now() else banned_at end
  where id = target;
  perform public._audit('account_status',
    target::text,
    jsonb_build_object('from', v_old, 'to', new_status, 'reason', reason, 'until', until));
end;
$$;

-- Verify / un-verify.
create or replace function public.admin_verify_user(target uuid, verified boolean)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner verification is immutable
  update public.profiles set verified = admin_verify_user.verified,
    verified_at = case when admin_verify_user.verified then now() else null end
  where id = target;
  perform public._audit('verify', target::text, jsonb_build_object('verified', verified));
end; $$;

-- Force logout from all devices.
create or replace function public.admin_force_logout(target uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner cannot be force-logged-out
  update public.profiles set force_logout_at = now() where id = target;
  delete from public.devices where user_id = target;
  perform public._audit('force_logout', target::text, '{}'::jsonb);
end; $$;

-- Delete account (soft).
create or replace function public.admin_delete_account(target uuid, reason text default null)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner cannot be deleted
  update public.profiles set account_status = 'disabled', deleted_at = now(),
    status_reason = coalesce(reason, 'deleted by admin') where id = target;
  insert into public.account_deletion_requests (user_id, reason, status, purge_after)
  values (target, coalesce(reason,'admin delete'), 'pending', now() + interval '30 days')
  on conflict (user_id) do update set reason = excluded.reason, status = 'pending';
  perform public._audit('delete_account', target::text, jsonb_build_object('reason', reason));
end; $$;

-- Promote / demote / assign roles. (Single permanent owner/admin: 'admin'/'owner'
-- are never assignable — 0025. Now also: the owner account can never be demoted or
-- role-changed by anyone.)
create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  -- Admin is permanent (the developer/owner allowlist). It cannot be assigned,
  -- transferred, or revoked through the app.
  if new_role not in ('user','moderator') then
    raise exception 'admin role is permanent and cannot be assigned';
  end if;
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner cannot be demoted/role-changed
  perform public._require_admin();     -- only the Owner-tier can manage roles
  select role into v_old from public.profiles where id = target;
  -- Never downgrade an existing admin row via this path either.
  if v_old = 'admin' then
    raise exception 'admin role is permanent and cannot be changed';
  end if;
  update public.profiles set role = new_role where id = target;
  perform public._audit('set_role', target::text, jsonb_build_object('from', v_old, 'to', new_role));
end;
$$;

-- Revoke premium.
create or replace function public.admin_revoke_premium(target uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin
  perform public._require_admin();
  perform public._guard_owner_target(target);
  perform public._guard_protect_owner(target);   -- owner premium is immutable
  update public.subscriptions set status = 'expired', current_period_end = now(), updated_at = now()
  where user_id = target;
  perform public._audit('revoke_premium', target::text, '{}'::jsonb);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) GRANTS  (signatures unchanged, so existing grants persist; re-grant is safe)
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.admin_set_account_status(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.admin_verify_user(uuid,boolean)                       to authenticated;
grant execute on function public.admin_force_logout(uuid)                              to authenticated;
grant execute on function public.admin_delete_account(uuid,text)                       to authenticated;
grant execute on function public.admin_set_role(uuid,text)                             to authenticated;
grant execute on function public.admin_revoke_premium(uuid)                            to authenticated;
