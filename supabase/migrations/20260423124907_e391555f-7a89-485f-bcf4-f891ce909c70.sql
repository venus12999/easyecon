
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "question-images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'question-images');
