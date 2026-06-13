CREATE TABLE public.paper_frq_rubrics (
  frq_id uuid PRIMARY KEY REFERENCES public.paper_frqs(id) ON DELETE CASCADE,
  rubric_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.paper_frq_rubrics TO service_role;

ALTER TABLE public.paper_frq_rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Backend service can read FRQ rubrics"
ON public.paper_frq_rubrics
FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Backend service can insert FRQ rubrics"
ON public.paper_frq_rubrics
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Backend service can update FRQ rubrics"
ON public.paper_frq_rubrics
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Backend service can delete FRQ rubrics"
ON public.paper_frq_rubrics
FOR DELETE
TO service_role
USING (true);

INSERT INTO public.paper_frq_rubrics (frq_id, rubric_note)
SELECT id, rubric_note
FROM public.paper_frqs
WHERE rubric_note IS NOT NULL;

ALTER TABLE public.paper_frqs DROP COLUMN rubric_note;

CREATE TRIGGER update_paper_frq_rubrics_updated_at
BEFORE UPDATE ON public.paper_frq_rubrics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Backend service can upload question images"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'question-images');

CREATE POLICY "Backend service can update question images"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'question-images')
WITH CHECK (bucket_id = 'question-images');

CREATE POLICY "Backend service can delete question images"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'question-images');