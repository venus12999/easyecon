CREATE TABLE IF NOT EXISTS public.mock_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  year int,
  total_seconds int NOT NULL DEFAULT 4200,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mock_papers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "papers public read" ON public.mock_papers;
CREATE POLICY "papers public read" ON public.mock_papers FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.paper_questions (
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  sort_order int NOT NULL,
  PRIMARY KEY (paper_id, question_id)
);
ALTER TABLE public.paper_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paper_questions public read" ON public.paper_questions;
CREATE POLICY "paper_questions public read" ON public.paper_questions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.paper_frqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE CASCADE,
  sort_order int NOT NULL,
  title text,
  content text NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_frqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paper_frqs public read" ON public.paper_frqs;
CREATE POLICY "paper_frqs public read" ON public.paper_frqs FOR SELECT USING (true);

INSERT INTO public.mock_papers (slug, title, year, total_seconds, description, sort_order)
VALUES ('ap-micro-2025', '2025 AP 微观经济真题卷', 2025, 4200,
  '官方 2025 年 AP 微观经济考试，60 道选择题（70 分钟）+ 3 道简答题。', 1)
ON CONFLICT (slug) DO NOTHING;