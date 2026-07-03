ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS exclude_from_pool boolean NOT NULL DEFAULT false;
ALTER TABLE public.paper_frqs ADD COLUMN IF NOT EXISTS exclude_from_pool boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS questions_pool_idx ON public.questions(exclude_from_pool) WHERE exclude_from_pool = false;

-- Backfill: exclude questions and FRQs belonging to real exam papers (year IS NOT NULL)
UPDATE public.questions q
SET exclude_from_pool = true
WHERE exclude_from_pool = false
  AND EXISTS (
    SELECT 1 FROM public.paper_questions pq
    JOIN public.mock_papers mp ON mp.id = pq.paper_id
    WHERE pq.question_id = q.id AND mp.year IS NOT NULL
  );

UPDATE public.paper_frqs pf
SET exclude_from_pool = true
WHERE exclude_from_pool = false
  AND EXISTS (
    SELECT 1 FROM public.mock_papers mp
    WHERE mp.id = pf.paper_id AND mp.year IS NOT NULL
  );