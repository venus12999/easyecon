
ALTER TABLE public.tutor_trial_bookings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS update_tutor_trial_bookings_updated_at ON public.tutor_trial_bookings;
CREATE TRIGGER update_tutor_trial_bookings_updated_at
  BEFORE UPDATE ON public.tutor_trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Users cancel own trial booking" ON public.tutor_trial_bookings;
CREATE POLICY "Users cancel own trial booking" ON public.tutor_trial_bookings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all trial bookings" ON public.tutor_trial_bookings;
CREATE POLICY "Admins view all trial bookings" ON public.tutor_trial_bookings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update all trial bookings" ON public.tutor_trial_bookings;
CREATE POLICY "Admins update all trial bookings" ON public.tutor_trial_bookings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_today_tutor_bookings()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  user_email text,
  teacher text,
  scheduled_at timestamptz,
  preferred_time text,
  contact text,
  note text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.user_id,
    (SELECT email FROM auth.users u WHERE u.id = b.user_id) AS user_email,
    b.teacher, b.scheduled_at, b.preferred_time, b.contact, b.note, b.status, b.created_at
  FROM public.tutor_trial_bookings b
  WHERE public.has_role(auth.uid(), 'admin')
    AND (
      (b.scheduled_at IS NOT NULL
        AND b.scheduled_at >= date_trunc('day', now())
        AND b.scheduled_at < date_trunc('day', now()) + interval '1 day')
      OR (b.scheduled_at IS NULL AND b.created_at >= date_trunc('day', now()))
    )
  ORDER BY b.scheduled_at NULLS LAST, b.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_today_tutor_bookings() TO authenticated;
