CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

INSERT INTO public.user_roles (user_id, role)
VALUES ('dbabd37f-7920-491c-b386-30d4ccbc7bd5', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE public.mock_exam_starts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exam_key text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  started_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mock_exam_starts TO authenticated;
GRANT ALL ON public.mock_exam_starts TO service_role;
ALTER TABLE public.mock_exam_starts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own mock starts" ON public.mock_exam_starts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX mock_exam_starts_user_env_started_idx ON public.mock_exam_starts(user_id, environment, started_at DESC);

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
        (status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  ) OR EXISTS (
    SELECT 1 FROM public.membership_adjustments
    WHERE user_id = user_uuid AND starts_at <= now() AND ends_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.release_ai_quota(p_user_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_kind = 'ai_explain' THEN
    UPDATE public.ai_daily_usage
    SET ai_explain_count = GREATEST(ai_explain_count - 1, 0), updated_at = now()
    WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
  ELSIF p_kind = 'frq_grade' THEN
    UPDATE public.ai_daily_usage
    SET frq_grade_count = GREATEST(frq_grade_count - 1, 0), updated_at = now()
    WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
  ELSE
    RAISE EXCEPTION 'Invalid quota kind';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_mock_access(p_user_id uuid, p_environment text, p_exam_key text)
RETURNS TABLE(allowed boolean, is_pro boolean, next_available_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro boolean;
  v_last timestamptz;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_environment NOT IN ('sandbox', 'live') OR length(p_exam_key) < 1 OR length(p_exam_key) > 120 THEN
    RAISE EXCEPTION 'Invalid mock access request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_environment, 0));
  v_pro := public.has_active_subscription(p_user_id, p_environment);
  IF v_pro THEN
    RETURN QUERY SELECT true, true, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT started_at INTO v_last
  FROM public.mock_exam_starts
  WHERE user_id = p_user_id AND environment = p_environment
  ORDER BY started_at DESC
  LIMIT 1;
  IF v_last IS NOT NULL AND v_last > now() - interval '7 days' THEN
    RETURN QUERY SELECT false, false, v_last + interval '7 days';
    RETURN;
  END IF;
  INSERT INTO public.mock_exam_starts(user_id, exam_key, environment)
  VALUES (p_user_id, p_exam_key, p_environment);
  RETURN QUERY SELECT true, false, NULL::timestamptz;
END;
$$;
GRANT EXECUTE ON FUNCTION public.consume_mock_access(uuid, text, text) TO authenticated, service_role;