ALTER TABLE public.wrong_questions
ADD COLUMN source text NOT NULL DEFAULT 'practice';

ALTER TABLE public.wrong_questions
ADD CONSTRAINT wrong_questions_source_valid CHECK (source IN ('practice', 'mock'));

ALTER TABLE public.wrong_questions
DROP CONSTRAINT wrong_questions_pkey;

ALTER TABLE public.wrong_questions
ADD CONSTRAINT wrong_questions_pkey PRIMARY KEY (user_id, question_id, source);