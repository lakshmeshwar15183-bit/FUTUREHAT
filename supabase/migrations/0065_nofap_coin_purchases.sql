-- NoFap Pro coin purchases (ledger on Lumixo Supabase; Razorpay secrets shared).
-- Service role only — no client policies.

CREATE TABLE IF NOT EXISTS public.nofap_razorpay_orders (
  order_id text PRIMARY KEY,
  firebase_uid text NOT NULL,
  product_id text NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  status text NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nofap_razorpay_orders_uid_idx
  ON public.nofap_razorpay_orders (firebase_uid);

CREATE TABLE IF NOT EXISTS public.nofap_coin_purchases (
  payment_id text PRIMARY KEY,
  order_id text NOT NULL,
  firebase_uid text NOT NULL,
  product_id text NOT NULL,
  coins_granted integer NOT NULL CHECK (coins_granted > 0),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nofap_coin_purchases_uid_idx
  ON public.nofap_coin_purchases (firebase_uid);

ALTER TABLE public.nofap_razorpay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nofap_coin_purchases ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon — service_role bypasses RLS.
COMMENT ON TABLE public.nofap_coin_purchases IS
  'NoFap Pro Razorpay coin pack ledger; written only by nofap-razorpay edge function';
