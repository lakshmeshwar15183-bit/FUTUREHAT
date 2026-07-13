-- 0054_razorpay_payments.sql
-- Production Razorpay payment ledger + webhook idempotency.
--
-- Premium is still activated ONLY via service-role admin_activate_subscription
-- (Edge Function after HMAC / webhook verification). This migration adds:
--   • razorpay_payments — durable payment/order records (duplicate-safe)
--   • razorpay_webhook_events — webhook event idempotency
--   • admin_record / status helpers used by payments-razorpay Edge Function
--
-- Client may SELECT own payment rows. All writes are service_role only.

-- ── Payment ledger ────────────────────────────────────────────────────────────
create table if not exists public.razorpay_payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id     text not null,
  razorpay_payment_id   text,
  amount                integer not null check (amount > 0), -- paise
  currency              text not null default 'INR',
  plan                  text not null check (plan in ('monthly', 'yearly')),
  status                text not null default 'created'
                          check (status in (
                            'created',
                            'attempted',
                            'authorized',
                            'captured',
                            'failed',
                            'refunded',
                            'cancelled'
                          )),
  error_code            text,
  error_description     text,
  refund_id             text,
  amount_refunded       integer not null default 0 check (amount_refunded >= 0),
  signature_verified    boolean not null default false,
  activated             boolean not null default false,
  notes                 jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One logical order row per Razorpay order.
create unique index if not exists uq_razorpay_payments_order
  on public.razorpay_payments (razorpay_order_id);

-- Payment id unique when present (prevents duplicate processing).
create unique index if not exists uq_razorpay_payments_payment
  on public.razorpay_payments (razorpay_payment_id)
  where razorpay_payment_id is not null and razorpay_payment_id <> '';

create index if not exists idx_razorpay_payments_user_created
  on public.razorpay_payments (user_id, created_at desc);

create index if not exists idx_razorpay_payments_status
  on public.razorpay_payments (status);

alter table public.razorpay_payments enable row level security;

drop policy if exists "read own razorpay payments" on public.razorpay_payments;
create policy "read own razorpay payments" on public.razorpay_payments
  for select to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated — service_role only.

-- ── Webhook event log (idempotency) ───────────────────────────────────────────
create table if not exists public.razorpay_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  event_id        text not null,
  event_type      text not null,
  razorpay_payment_id text,
  razorpay_order_id   text,
  payload         jsonb not null default '{}'::jsonb,
  processed       boolean not null default false,
  process_error   text,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_razorpay_webhook_event_id
  on public.razorpay_webhook_events (event_id);

create index if not exists idx_razorpay_webhook_created
  on public.razorpay_webhook_events (created_at desc);

alter table public.razorpay_webhook_events enable row level security;
-- No client policies — service_role only (webhooks never use end-user JWT).

-- ── Service helpers ───────────────────────────────────────────────────────────

-- Insert order placeholder when create_order succeeds (idempotent on order id).
create or replace function public.admin_upsert_razorpay_order(
  p_user_id uuid,
  p_order_id text,
  p_amount integer,
  p_currency text,
  p_plan text,
  p_notes jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or coalesce(trim(p_order_id), '') = '' then
    raise exception 'user and order required';
  end if;
  if p_plan is null or p_plan not in ('monthly', 'yearly') then
    raise exception 'invalid plan';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;

  insert into public.razorpay_payments as rp (
    user_id, razorpay_order_id, amount, currency, plan, status, notes, updated_at
  ) values (
    p_user_id, p_order_id, p_amount, coalesce(nullif(p_currency, ''), 'INR'),
    p_plan, 'created', coalesce(p_notes, '{}'::jsonb), now()
  )
  on conflict (razorpay_order_id) do update set
    updated_at = now()
  returning id into rid;

  return rid;
end;
$$;

revoke all on function public.admin_upsert_razorpay_order(uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_upsert_razorpay_order(uuid, text, integer, text, text, jsonb)
  to service_role;

-- Record verified capture / failure / refund (idempotent on payment id).
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

  -- Cross-account binding: payment id must not belong to another user.
  if coalesce(trim(p_payment_id), '') <> '' then
    select user_id into existing_user
    from public.razorpay_payments
    where razorpay_payment_id = p_payment_id
    limit 1;
    if existing_user is not null and existing_user is distinct from p_user_id then
      raise exception 'payment already bound to another account';
    end if;
  end if;

  -- Prefer update by order id (created at checkout).
  select id, status into rid, existing_status
  from public.razorpay_payments
  where razorpay_order_id = p_order_id
  limit 1;

  if rid is not null then
    -- Do not regress a captured/activated row back to failed/cancelled from a race.
    if existing_status = 'captured' and p_status in ('failed', 'cancelled', 'attempted', 'created') then
      update public.razorpay_payments
      set updated_at = now()
      where id = rid;
      return rid;
    end if;

    update public.razorpay_payments set
      user_id = p_user_id,
      razorpay_payment_id = coalesce(nullif(trim(p_payment_id), ''), razorpay_payment_id),
      amount = coalesce(p_amount, amount),
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

  insert into public.razorpay_payments (
    user_id, razorpay_order_id, razorpay_payment_id, amount, currency, plan,
    status, signature_verified, activated, error_code, error_description,
    refund_id, amount_refunded, notes, updated_at
  ) values (
    p_user_id, p_order_id, nullif(trim(p_payment_id), ''), p_amount,
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

-- Soft-cancel premium when the payment that activated it is fully refunded.
create or replace function public.admin_revoke_premium_for_payment(
  p_user_id uuid,
  p_payment_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or coalesce(trim(p_payment_id), '') = '' then
    return;
  end if;

  update public.subscriptions
  set
    status = 'cancelled',
    cancel_at_period_end = true,
    current_period_end = least(current_period_end, now()),
    updated_at = now()
  where user_id = p_user_id
    and provider = 'razorpay'
    and provider_subscription_id = p_payment_id
    and status = 'active';
end;
$$;

revoke all on function public.admin_revoke_premium_for_payment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_revoke_premium_for_payment(uuid, text)
  to service_role;

-- Webhook event claim (returns true if this is the first time we see event_id).
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
      event_id, event_type, razorpay_payment_id, razorpay_order_id, payload, processed
    ) values (
      p_event_id, coalesce(p_event_type, 'unknown'),
      nullif(trim(p_payment_id), ''), nullif(trim(p_order_id), ''),
      coalesce(p_payload, '{}'::jsonb), false
    );
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;

revoke all on function public.admin_claim_razorpay_webhook(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_claim_razorpay_webhook(text, text, text, text, jsonb)
  to service_role;

create or replace function public.admin_mark_razorpay_webhook_processed(
  p_event_id text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;

  update public.razorpay_webhook_events
  set processed = (p_error is null),
      process_error = p_error
  where event_id = p_event_id;
end;
$$;

revoke all on function public.admin_mark_razorpay_webhook_processed(text, text)
  from public, anon, authenticated;
grant execute on function public.admin_mark_razorpay_webhook_processed(text, text)
  to service_role;
