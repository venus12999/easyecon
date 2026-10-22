ALTER TABLE public.school_assignments
  ADD COLUMN score_max integer;

COMMENT ON COLUMN public.school_assignments.score_max IS 'Teacher-defined maximum score for this assignment; NULL means use the default computed maximum.';