-- 1) Remove legacy admin password hash column (unused; admin now uses JWT + email allowlist)
ALTER TABLE public.admin_settings DROP COLUMN IF EXISTS password_hash;

-- 2) Restrict access to sensitive Paddle identifier columns on subscriptions
-- These columns are only ever read by server routes using the service role.
REVOKE SELECT (paddle_customer_id, paddle_subscription_id) ON public.subscriptions FROM authenticated;
REVOKE SELECT (paddle_customer_id, paddle_subscription_id) ON public.subscriptions FROM anon;
-- Grant non-sensitive columns explicitly to authenticated owners (needed because column-level REVOKE removes the broad SELECT grant).
GRANT SELECT (id, user_id, environment, price_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at) ON public.subscriptions TO authenticated;