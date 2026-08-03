CREATE TABLE public.manual_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no text NOT NULL UNIQUE,
  kind text NOT NULL,
  plan_key text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  amount_cny numeric NOT NULL,
  channel text NOT NULL,
  proof_path text,
  payer_note text,
  status text NOT NULL DEFAULT 'pending',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_manual_payments_user ON public.manual_payments(user_id);
CREATE INDEX idx_manual_payments_status ON public.manual_payments(status);

GRANT SELECT, INSERT ON public.manual_payments TO authenticated;
GRANT ALL ON public.manual_payments TO service_role;

ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own manual payments"
  ON public.manual_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users create own manual payments"
  ON public.manual_payments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE TRIGGER update_manual_payments_updated_at
  BEFORE UPDATE ON public.manual_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_manual_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind NOT IN ('membership', 'tutor') THEN
    RAISE EXCEPTION 'kind must be membership or tutor';
  END IF;
  IF NEW.channel NOT IN ('wechat', 'alipay') THEN
    RAISE EXCEPTION 'channel must be wechat or alipay';
  END IF;
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF NEW.quantity < 1 OR NEW.quantity > 60 THEN
    RAISE EXCEPTION 'invalid quantity';
  END IF;
  IF NEW.amount_cny <= 0 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_manual_payment_trigger
  BEFORE INSERT OR UPDATE ON public.manual_payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_manual_payment();