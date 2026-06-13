CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  paddle_subscription_id text NOT NULL UNIQUE,
  paddle_customer_id text NOT NULL,
  product_id text NOT NULL,
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trialing','active','past_due','paused','canceled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_subscriptions_user_environment ON public.subscriptions(user_id, environment, created_at DESC);

CREATE TABLE public.ai_daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  ai_explain_count integer NOT NULL DEFAULT 0 CHECK (ai_explain_count >= 0),
  frq_grade_count integer NOT NULL DEFAULT 0 CHECK (frq_grade_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, usage_date)
);
GRANT SELECT ON public.ai_daily_usage TO authenticated;
GRANT ALL ON public.ai_daily_usage TO service_role;
ALTER TABLE public.ai_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own AI usage" ON public.ai_daily_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_ai_daily_usage_user_date ON public.ai_daily_usage(user_id, usage_date DESC);

CREATE TABLE public.membership_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  admin_user_id uuid NOT NULL,
  days_granted integer NOT NULL CHECK (days_granted > 0 AND days_granted <= 3660),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.membership_adjustments TO service_role;
ALTER TABLE public.membership_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_membership_adjustments_user_end ON public.membership_adjustments(user_id, ends_at DESC);

CREATE OR REPLACE FUNCTION public.has_active_subscription(user_uuid uuid, check_env text DEFAULT 'live')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
      AND environment = check_env
      AND (
        (status IN ('active','trialing','past_due') AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  ) OR EXISTS (
    SELECT 1 FROM public.membership_adjustments
    WHERE user_id = user_uuid AND starts_at <= now() AND ends_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_user_id uuid, p_kind text, p_environment text)
RETURNS TABLE(allowed boolean, used integer, quota integer, is_pro boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro boolean;
  v_used integer;
  v_quota integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_kind NOT IN ('ai_explain', 'frq_grade') OR p_environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid quota request';
  END IF;
  v_pro := public.has_active_subscription(p_user_id, p_environment);
  v_quota := CASE WHEN p_kind = 'ai_explain' THEN CASE WHEN v_pro THEN 30 ELSE 3 END ELSE CASE WHEN v_pro THEN 10 ELSE 1 END END;
  INSERT INTO public.ai_daily_usage(user_id, usage_date)
  VALUES (p_user_id, CURRENT_DATE)
  ON CONFLICT (user_id, usage_date) DO NOTHING;
  IF p_kind = 'ai_explain' THEN
    UPDATE public.ai_daily_usage SET ai_explain_count = ai_explain_count + 1, updated_at = now()
    WHERE user_id = p_user_id AND usage_date = CURRENT_DATE AND ai_explain_count < v_quota
    RETURNING ai_explain_count INTO v_used;
  ELSE
    UPDATE public.ai_daily_usage SET frq_grade_count = frq_grade_count + 1, updated_at = now()
    WHERE user_id = p_user_id AND usage_date = CURRENT_DATE AND frq_grade_count < v_quota
    RETURNING frq_grade_count INTO v_used;
  END IF;
  IF v_used IS NULL THEN
    SELECT CASE WHEN p_kind = 'ai_explain' THEN ai_explain_count ELSE frq_grade_count END INTO v_used
    FROM public.ai_daily_usage WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
    RETURN QUERY SELECT false, COALESCE(v_used, 0), v_quota, v_pro;
  ELSE
    RETURN QUERY SELECT true, v_used, v_quota, v_pro;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, text, text) TO authenticated, service_role;

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ai_daily_usage_updated_at BEFORE UPDATE ON public.ai_daily_usage FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_membership_adjustments_updated_at BEFORE UPDATE ON public.membership_adjustments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();