CREATE TABLE public.tutor_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  paddle_transaction_id text NOT NULL UNIQUE,
  paddle_subscription_id text,
  price_external_id text NOT NULL,
  product_external_id text,
  quantity integer NOT NULL DEFAULT 1,
  amount_total numeric,
  currency_code text,
  status text NOT NULL DEFAULT 'completed',
  membership_days_granted integer NOT NULL DEFAULT 0,
  membership_ends_at timestamptz,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tutor_orders_user ON public.tutor_orders(user_id, created_at DESC);

GRANT SELECT ON public.tutor_orders TO authenticated;
GRANT ALL ON public.tutor_orders TO service_role;

ALTER TABLE public.tutor_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tutor orders"
  ON public.tutor_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages tutor orders"
  ON public.tutor_orders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_tutor_orders_updated
  BEFORE UPDATE ON public.tutor_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Allow users to read their own auto-granted membership adjustments
CREATE POLICY "Users can view own membership adjustments"
  ON public.membership_adjustments FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT ON public.membership_adjustments TO authenticated;