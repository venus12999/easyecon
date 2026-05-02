-- 1. profiles 表（一邮箱一账号；user_id 唯一保证）
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. 自动创建 profile 触发器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. 答题记录
CREATE TABLE IF NOT EXISTS public.answer_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  knowledge_point_id uuid NOT NULL,
  picked_answer character,
  is_correct boolean NOT NULL,
  mode text NOT NULL DEFAULT 'practice', -- practice / mock
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_user ON public.answer_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_question ON public.answer_attempts(question_id);
ALTER TABLE public.answer_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users insert own attempts" ON public.answer_attempts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users read own attempts" ON public.answer_attempts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. 模考记录
CREATE TABLE IF NOT EXISTS public.mock_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total integer NOT NULL,
  correct integer NOT NULL,
  duration_seconds integer NOT NULL,
  detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_user ON public.mock_attempts(user_id, created_at DESC);
ALTER TABLE public.mock_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users insert own mocks" ON public.mock_attempts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users read own mocks" ON public.mock_attempts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 5. 错题本（云端版）
CREATE TABLE IF NOT EXISTS public.wrong_questions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
ALTER TABLE public.wrong_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own wrong list select" ON public.wrong_questions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users manage own wrong list insert" ON public.wrong_questions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage own wrong list delete" ON public.wrong_questions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
