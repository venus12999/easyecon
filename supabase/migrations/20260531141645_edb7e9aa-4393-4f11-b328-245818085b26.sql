
ALTER TABLE public.mock_papers
  ADD COLUMN IF NOT EXISTS frq_seconds integer NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS break_seconds integer NOT NULL DEFAULT 600;

ALTER TABLE public.paper_frqs
  ADD COLUMN IF NOT EXISTS image_text text,
  ADD COLUMN IF NOT EXISTS max_score integer NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS rubric_note text;

ALTER TABLE public.admin_settings
  ADD COLUMN IF NOT EXISTS frq_grader_prompt text;

UPDATE public.admin_settings
SET frq_grader_prompt = $PROMPT$你是 AP Microeconomics（AP 微观经济）资深官方阅卷官（Reader），严格按 College Board 公布的 FRQ 评分指南（Scoring Guidelines / Rubric）逐项判分，专为中国学生服务。

严格规则：
1. 仅输出一个 JSON 对象，不要任何 Markdown 代码块、解释性前言或后记。
2. 紧扣 AP CED 大纲与微观经济学标准定义；保留专业术语英文原文（不可缩写，例如必须写 marginal cost，不能写 MC），中文评语可在术语后用括号附中文翻译。
3. 按官方 rubric 把每个 scoring point 拆开判分，逐点说明是否给分、为什么。
4. 学生答案可能是文字、图片中的手写内容或上传文件中的文字；都以学生最终表达的内容为准，结合题干、图中文字和评分指南综合判断。
5. 评分必须客观、严格，不要为了鼓励而放水；同时必须指出错误原因与正确做法。
6. 评语用简体中文撰写，分点清晰，避免空泛。

输出严格 JSON：
{
  "total_score": <整数，本题得分>,
  "max_score": <整数，本题满分，按用户输入>,
  "breakdown": [
    { "point": "<scoring point 简述，如 'Part (a)(i): correctly draws PPC'>", "awarded": <true|false>, "comment": "<为何给/不给该分>" }
  ],
  "overall_comment": "<对学生整体表现的简评，含主要扣分原因>",
  "suggestions": "<给学生的复习建议，紧扣 AP rubric>"
}$PROMPT$
WHERE id = 1;

CREATE TABLE IF NOT EXISTS public.frq_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  paper_id uuid NOT NULL,
  frq_id uuid NOT NULL,
  mode text NOT NULL,
  answer_text text,
  answer_file_url text,
  answer_file_kind text,
  ai_score integer,
  ai_max_score integer,
  ai_breakdown jsonb,
  ai_overall text,
  ai_suggestions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.frq_submissions TO authenticated;
GRANT ALL ON public.frq_submissions TO service_role;

ALTER TABLE public.frq_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own frq submissions"
  ON public.frq_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own frq submissions"
  ON public.frq_submissions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_frq_submissions_user_paper
  ON public.frq_submissions (user_id, paper_id, created_at DESC);
