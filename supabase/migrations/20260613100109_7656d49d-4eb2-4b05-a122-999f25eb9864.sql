REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_quota(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, text, text) TO service_role;
CREATE POLICY "Service role manages membership adjustments" ON public.membership_adjustments FOR ALL TO service_role USING (true) WITH CHECK (true);