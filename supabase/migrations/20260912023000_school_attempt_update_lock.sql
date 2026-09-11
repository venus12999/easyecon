-- Students must not rewrite scores/answers after submit. Writes go through service-role APIs.

DROP POLICY IF EXISTS school_attempts_student_update ON public.school_attempts;
CREATE POLICY school_attempts_student_update ON public.school_attempts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND submitted_at IS NULL)
  WITH CHECK (user_id = auth.uid() AND submitted_at IS NULL);

REVOKE INSERT, UPDATE ON public.school_attempts FROM authenticated;
