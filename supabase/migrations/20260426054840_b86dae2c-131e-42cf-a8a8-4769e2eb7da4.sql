-- Add option_e column to questions table to support 5-option multiple choice
ALTER TABLE public.questions ADD COLUMN option_e text;

-- Update CHECK constraint on correct_answer if any exists is implicit (column is character).
-- Allow A-E values via a validation trigger (avoids immutability issues).
CREATE OR REPLACE FUNCTION public.validate_question_answer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.correct_answer NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'correct_answer must be one of A, B, C, D, E (got %)', NEW.correct_answer;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_question_answer ON public.questions;
CREATE TRIGGER trg_validate_question_answer
BEFORE INSERT OR UPDATE ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.validate_question_answer();