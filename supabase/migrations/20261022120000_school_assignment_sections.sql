-- Per-exam section clocks. Null means an older exam that only has one window.

ALTER TABLE public.school_assignments
  ADD COLUMN IF NOT EXISTS mcq_seconds integer,
  ADD COLUMN IF NOT EXISTS frq_seconds integer,
  ADD COLUMN IF NOT EXISTS break_seconds integer;

ALTER TABLE public.school_assignments
  DROP CONSTRAINT IF EXISTS school_assignments_section_times;

ALTER TABLE public.school_assignments
  ADD CONSTRAINT school_assignments_section_times CHECK (
    (mcq_seconds IS NULL AND frq_seconds IS NULL AND break_seconds IS NULL)
    OR (
      mcq_seconds BETWEEN 600 AND 10800
      AND frq_seconds BETWEEN 0 AND 10800
      AND break_seconds BETWEEN 0 AND 1200
      AND (frq_seconds = 0 OR frq_seconds >= 600)
      AND (frq_seconds > 0 OR break_seconds = 0)
    )
  );
