ALTER TABLE public.frq_submissions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS frq_submissions_user_paper_active_idx ON public.frq_submissions(user_id, paper_id) WHERE archived_at IS NULL;
GRANT UPDATE (archived_at) ON public.frq_submissions TO authenticated;
DROP POLICY IF EXISTS "Users can archive own frq submissions" ON public.frq_submissions;
CREATE POLICY "Users can archive own frq submissions" ON public.frq_submissions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);