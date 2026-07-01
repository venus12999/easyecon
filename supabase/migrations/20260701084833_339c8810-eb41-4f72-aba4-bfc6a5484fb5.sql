
CREATE TABLE public.tutor_trial_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher text NOT NULL,
  preferred_time text,
  contact text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tutor_trial_bookings TO authenticated;
GRANT ALL ON public.tutor_trial_bookings TO service_role;
ALTER TABLE public.tutor_trial_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own trial booking" ON public.tutor_trial_bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own trial booking" ON public.tutor_trial_bookings FOR INSERT WITH CHECK (auth.uid() = user_id);
