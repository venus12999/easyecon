-- Treat owner email as lifetime Pro in SQL quota / mock-access checks.
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
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = user_uuid AND lower(email) = 'chenziyanyiyi@qq.com'
  );
$$;

INSERT INTO public.membership_adjustments (user_id, admin_user_id, days_granted, starts_at, ends_at, note)
SELECT p.user_id, p.user_id, 3660, now(), '2099-12-31 23:59:59+00', '永久 VIP'
FROM public.profiles p
WHERE lower(p.email) = 'chenziyanyiyi@qq.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.membership_adjustments a
    WHERE a.user_id = p.user_id AND a.note = '永久 VIP' AND a.ends_at > now()
  );
