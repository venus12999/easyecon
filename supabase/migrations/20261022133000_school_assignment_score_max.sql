-- Teacher-chosen full score. The 1–5 AP score stays on the 90-point composite.

ALTER TABLE public.school_assignments
  ADD COLUMN IF NOT EXISTS score_max integer;

ALTER TABLE public.school_assignments
  DROP CONSTRAINT IF EXISTS school_assignments_score_max;

ALTER TABLE public.school_assignments
  ADD CONSTRAINT school_assignments_score_max CHECK (
    score_max IS NULL OR score_max BETWEEN 10 AND 300
  );
