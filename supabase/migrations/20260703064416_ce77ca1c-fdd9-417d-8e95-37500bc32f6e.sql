-- Inline has_role() in RLS policies so we no longer need to grant authenticated EXECUTE on it
DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins view all trial bookings" ON public.tutor_trial_bookings;
CREATE POLICY "Admins view all trial bookings"
ON public.tutor_trial_bookings
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins update all trial bookings" ON public.tutor_trial_bookings;
CREATE POLICY "Admins update all trial bookings"
ON public.tutor_trial_bookings
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Revoke EXECUTE from authenticated on the three flagged SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_taken_tutor_slots(text, date) FROM authenticated;
