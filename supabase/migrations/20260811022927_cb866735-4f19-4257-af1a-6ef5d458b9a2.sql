ALTER TABLE public.answer_attempts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS answer_attempts_user_kp_archived_idx ON public.answer_attempts (user_id, knowledge_point_id, archived_at);

DROP POLICY IF EXISTS "Users can archive their own attempts" ON public.answer_attempts;
CREATE POLICY "Users can archive their own attempts"
ON public.answer_attempts FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT UPDATE ON public.answer_attempts TO authenticated;

ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS paper_slug text;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS paper_title text;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'paper';