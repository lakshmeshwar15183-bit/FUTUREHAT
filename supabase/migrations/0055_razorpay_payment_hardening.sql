-- 0055_razorpay_payment_hardening.sql
-- Fixes from production payment audit:
--   1) Webhook claim must allow re-processing when previous attempt failed
--      (otherwise Razorpay retries are silently dropped — CRITICAL).
--   2) amount updates must never write 0 (CHECK amount > 0).
--   3) cancel path: mark unpaid orders cancelled without regressing captured.

-- ── Webhook claim with failed-retry ───────────────────────────────────────────
create or replace function public.admin_claim_razorpay_webhook(
  p_event_id text,
  p_event_type text,
  p_payment_id text default null,
  p_order_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_processed boolean;
  existing_error text;
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  if coalesce(trim(p_event_id), '') = '' then
    raise exception 'event id required';
  end if;

  begin
    insert into public.razorpay_webhook_events (
      event_id, event_type, razorpay_payment_id, razorpay_order_id, payload, processed, process_error
    ) values (
      p_event_id, coalesce(p_event_type, 'unknown'),
      nullif(trim(p_payment_id), ''), nullif(trim(p_order_id), ''),
      coalesce(p_payload, '{}'::jsonb), false, null
    );
    return true;
  exception when unique_violation then
    select processed, process_error
      into existing_processed, existing_error
    from public.razorpay_webhook_events
    where event_id = p_event_id;

    -- Successfully processed → true duplicate, skip.
    if existing_processed is true then
      return false;
    end if;

    -- Re-claim when:
    --   • previous attempt failed (process_error set), OR
    --   • stuck in-flight > 2 minutes (worker crash without marking error).
    -- Fresh in-flight (no error, young) → skip concurrent double-processing.
    if existing_error is null then
      if exists (
        select 1 from public.razorpay_webhook_events
        where event_id = p_event_id
          and processed = false
          and process_error is null
          and created_at > now() - interval '2 minutes'
      ) then
        return false;
      end if;
    end if;

    update public.razorpay_webhook_events
    set
      process_error = null,
      event_type = coalesce(p_event_type, event_type),
      razorpay_payment_id = coalesce(nullif(trim(p_payment_id), ''), razorpay_payment_id),
      razorpay_order_id = coalesce(nullif(trim(p_order_id), ''), razorpay_order_id),
      payload = coalesce(p_payload, payload)
    where event_id = p_event_id
      and processed = false;

    return found;
  end;
end;
$$;

revoke all on function public.admin_claim_razorpay_webhook(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_claim_razorpay_webhook(text, text, text, text, jsonb)
  to service_role;

-- ── Safer amount / cancel status on record ────────────────────────────────────
create or replace function public.admin_record_razorpay_payment(
  p_user_id uuid,
  p_order_id text,
  p_payment_id text,
  p_amount integer,
  p_currency text,
  p_plan text,
  p_status text,
  p_signature_verified boolean default false,
  p_activated boolean default false,
  p_error_code text default null,
  p_error_description text default null,
  p_refund_id text default null,
  p_amount_refunded integer default 0,
  p_notes jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  existing_user uuid;
  existing_status text;
  safe_amount integer;
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or coalesce(trim(p_order_id), '') = '' then
    raise exception 'user and order required';
  end if;
  if p_status is null or p_status not in (
    'created','attempted','authorized','captured','failed','refunded','cancelled'
  ) then
    raise exception 'invalid status';
  end if;

  safe_amount := case when p_amount is null or p_amount <= 0 then null else p_amount end;

  if coalesce(trim(p_payment_id), '') <> '' then
    select user_id into existing_user
    from public.razorpay_payments
    where razorpay_payment_id = p_payment_id
    limit 1;
    if existing_user is not null and existing_user is distinct from p_user_id then
      raise exception 'payment already bound to another account';
    end if;
  end if;

  select id, status into rid, existing_status
  from public.razorpay_payments
  where razorpay_order_id = p_order_id
  limit 1;

  if rid is not null then
    -- Never regress a successful capture to failed/cancelled/attempted.
    if existing_status = 'captured' and p_status in ('failed', 'cancelled', 'attempted', 'created') then
      update public.razorpay_payments set updated_at = now() where id = rid;
      return rid;
    end if;
    -- Refunded is terminal relative to cancelled.
    if existing_status = 'refunded' and p_status in ('failed', 'cancelled', 'attempted', 'created') then
      update public.razorpay_payments set updated_at = now() where id = rid;
      return rid;
    end if;

    update public.razorpay_payments set
      user_id = p_user_id,
      razorpay_payment_id = coalesce(nullif(trim(p_payment_id), ''), razorpay_payment_id),
      amount = coalesce(safe_amount, amount),
      currency = coalesce(nullif(p_currency, ''), currency),
      plan = coalesce(nullif(p_plan, ''), plan),
      status = p_status,
      signature_verified = signature_verified or coalesce(p_signature_verified, false),
      activated = activated or coalesce(p_activated, false),
      error_code = coalesce(p_error_code, error_code),
      error_description = coalesce(p_error_description, error_description),
      refund_id = coalesce(p_refund_id, refund_id),
      amount_refunded = greatest(coalesce(p_amount_refunded, 0), amount_refunded),
      notes = case
        when p_notes is null or p_notes = '{}'::jsonb then notes
        else notes || p_notes
      end,
      updated_at = now()
    where id = rid;
    return rid;
  end if;

  if safe_amount is null then
    raise exception 'invalid amount';
  end if;

  insert into public.razorpay_payments (
    user_id, razorpay_order_id, razorpay_payment_id, amount, currency, plan,
    status, signature_verified, activated, error_code, error_description,
    refund_id, amount_refunded, notes, updated_at
  ) values (
    p_user_id, p_order_id, nullif(trim(p_payment_id), ''), safe_amount,
    coalesce(nullif(p_currency, ''), 'INR'), p_plan, p_status,
    coalesce(p_signature_verified, false), coalesce(p_activated, false),
    p_error_code, p_error_description, p_refund_id,
    coalesce(p_amount_refunded, 0), coalesce(p_notes, '{}'::jsonb), now()
  )
  returning id into rid;

  return rid;
end;
$$;

revoke all on function public.admin_record_razorpay_payment(
  uuid, text, text, integer, text, text, text, boolean, boolean, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_record_razorpay_payment(
  uuid, text, text, integer, text, text, text, boolean, boolean, text, text, text, integer, jsonb
) to service_role;
