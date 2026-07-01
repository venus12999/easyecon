
ALTER TABLE public.tutor_trial_bookings
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS tutor_trial_bookings_teacher_slot_uniq
  ON public.tutor_trial_bookings (teacher, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

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
    AND scheduled_at >= p_day::timestamptz
    AND scheduled_at < (p_day + 1)::timestamptz;
$$;

GRANT EXECUTE ON FUNCTION public.get_taken_tutor_slots(text, date) TO authenticated, anon;
