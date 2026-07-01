
-- Lock down SECURITY DEFINER functions: revoke default PUBLIC/anon EXECUTE,
-- grant only to roles that actually need to call them.

-- Trigger-only: nobody should call directly
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Called only from server (service_role) code
REVOKE ALL ON FUNCTION public.consume_mock_access(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mock_access(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.release_ai_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(uuid, text) TO service_role;

-- Used by RLS policies and server code; keep for authenticated + service_role, drop anon/public
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- Called by signed-in users from the client (tutor booking page)
REVOKE ALL ON FUNCTION public.get_taken_tutor_slots(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_taken_tutor_slots(text, date) TO authenticated, service_role;
