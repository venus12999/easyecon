ALTER TABLE public.tutor_trial_bookings
  DROP CONSTRAINT IF EXISTS tutor_trial_bookings_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS tutor_trial_bookings_active_user_uniq
  ON public.tutor_trial_bookings (user_id)
  WHERE status <> 'cancelled';

DROP INDEX IF EXISTS tutor_trial_bookings_teacher_slot_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS tutor_trial_bookings_teacher_slot_uniq
  ON public.tutor_trial_bookings (teacher, scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status <> 'cancelled';

CREATE OR REPLACE FUNCTION public.get_taken_tutor_slots(p_teacher text, p_day date)
RETURNS TABLE(scheduled_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT scheduled_at
  FROM public.tutor_trial_bookings
  WHERE teacher = p_teacher
    AND scheduled_at IS NOT NULL
    AND status <> 'cancelled'
    AND scheduled_at >= p_day::timestamptz
    AND scheduled_at < (p_day + 1)::timestamptz;
$$;