ALTER TABLE public.school_assignments
  ADD COLUMN mcq_seconds integer,
  ADD COLUMN frq_seconds integer,
  ADD COLUMN break_seconds integer;

COMMENT ON COLUMN public.school_assignments.mcq_seconds IS 'Section timing: seconds allowed for the MCQ section; NULL means use the paper default.';
COMMENT ON COLUMN public.school_assignments.frq_seconds IS 'Section timing: seconds allowed for the FRQ section; NULL means use the paper default.';
COMMENT ON COLUMN public.school_assignments.break_seconds IS 'Section timing: seconds allowed for the break between sections; NULL means use the paper default.';