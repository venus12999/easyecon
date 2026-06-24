CREATE TABLE public.frq_drafts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE CASCADE,
  frq_id uuid NOT NULL REFERENCES public.paper_frqs(id) ON DELETE CASCADE,
  answer_text text,
  answer_file_url text,
  answer_file_kind text,
  answer_file_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, frq_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.frq_drafts TO authenticated;
GRANT ALL ON public.frq_drafts TO service_role;

ALTER TABLE public.frq_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "frq_drafts_own_select" ON public.frq_drafts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "frq_drafts_own_insert" ON public.frq_drafts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "frq_drafts_own_update" ON public.frq_drafts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "frq_drafts_own_delete" ON public.frq_drafts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX frq_drafts_user_paper_idx ON public.frq_drafts (user_id, paper_id);

CREATE TRIGGER frq_drafts_set_updated_at
  BEFORE UPDATE ON public.frq_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();