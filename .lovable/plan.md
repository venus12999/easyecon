## 目标

把每份真题卷拆成「仿真模式」和「练习模式」两种作答方式，并为 FRQ 大题增加图片文字提取、用户作答提交（文字/文件/图片）以及 AI 评分（按 AP 评分标准）。管理后台可配置评分 prompt。

适用范围：仅 **真题卷（mock/$slug）**。随机模考与刷题不变。

---

## 一、两种作答模式（mock/$slug）

入口页（idle 阶段）改成"选择模式"页面，并在右上角始终显示模式徽章。

### 仿真模式（Exam Simulation）
严格按真实 AP 考试流程：

1. **Section I · MCQ**：限时（卷的 `total_seconds`，默认 70 分钟），时间到自动收卷。
2. **休息阶段**：10 分钟倒计时屏，提供「跳过休息」按钮。
3. **Section II · FRQ**：限时（按 AP 微观规则默认 60 分钟，存到 `mock_papers.frq_seconds`，可在管理后台改），到点自动提交。允许打字 / 上传图片 / 上传文件作为答案。
4. **结果页**：交完 FRQ 后才显示 MCQ 总分、每题正误、AI 解析，以及每道 FRQ 的 AI 评分（分数 + 评语 + 按 rubric 拆解）。

中途禁止返回修改 Section I。

### 练习模式（Practice）
无时间限制：

1. **Section I**：自由作答，可任意切换、跳题。
2. 60 题全部完成后，出现「进入大题」按钮（也可手动点击「跳到大题」）。
3. **Section II**：同样三种提交方式，无时间限制。
4. 提交 FRQ 之后，再一次性展示 MCQ 正确答案与解析、FRQ 的 AI 评分。

两种模式共用同一套 MCQ / FRQ 渲染组件，只在外层加阶段状态机（`mcq → break → frq → result`）。

---

## 二、FRQ 图片文字提取（管理后台触发）

- 在 `admin.tsx` 的 FRQ 编辑面板，每条 FRQ 旁加「提取图片文字」按钮（仅当 `image_url` 不为空时显示）。
- 点击后调用新的服务端函数 `extractFrqImageText`，用 `google/gemini-2.5-pro` 视觉识别图中所有文字（保留原文、不缩写，符合现有 memory 规则），结果写入 `paper_frqs.image_text`。
- 前台 FRQ 渲染：若有 `image_text`，在图片下方显示「图中文字」展开块。

---

## 三、FRQ 作答 + AI 评分

### 用户作答
每道 FRQ 下方加一个"作答区"组件，支持：
- 直接打字（Textarea）
- 上传图片（手写答案拍照）
- 上传 PDF / docx 文件

文件 / 图片上传到 `question-images` bucket（新建子目录 `frq-answers/<user_id>/<paper_id>/<frq_id>/`），存 URL。

### AI 评分
- 新服务端函数 `gradeFrq`：输入 = FRQ 题干 + image_text + 用户答案（文本或文件 URL，图片直接喂给多模态模型，PDF 用 document parsing 先抽文本）。
- 用 `google/gemini-2.5-pro`，system prompt = 管理后台配置的「FRQ 评分 Prompt」，user prompt 拼装 rubric 上下文（满分、题号、题目原文、图中文字、学生答案）。
- 要求模型返回结构化 JSON：`{ total_score, max_score, breakdown: [{point, awarded, comment}], overall_comment, suggestions }`。
- 结果写入 `frq_submissions` 表，并在结果页展示。

---

## 四、管理后台

在 `admin.tsx` Tabs 增加 **「FRQ 评分」** 标签页：
- 一个大 Textarea，编辑全局「FRQ 评分 Prompt」（存在 `admin_settings.frq_grader_prompt`）。
- 一个 Textarea 编辑「默认 FRQ 总分」（默认 9 分，可被每道 FRQ 自定义覆盖）。
- 提供「恢复默认 prompt」按钮（默认 prompt 内置：要求模型扮演 AP 阅卷官，按官方 rubric 逐项给分，输出指定 JSON 结构）。
- 现有 FRQ 编辑器加：`max_score`、（可选）`rubric_note` 输入项。

---

## 五、技术细节

### 数据库变更（migration）
```sql
-- mock_papers: 增加 FRQ 时长
ALTER TABLE public.mock_papers
  ADD COLUMN frq_seconds integer NOT NULL DEFAULT 3600,
  ADD COLUMN break_seconds integer NOT NULL DEFAULT 600;

-- paper_frqs: 图中文字 + 每题分值 + rubric 备注
ALTER TABLE public.paper_frqs
  ADD COLUMN image_text text,
  ADD COLUMN max_score integer NOT NULL DEFAULT 9,
  ADD COLUMN rubric_note text;

-- admin_settings: 评分 prompt
ALTER TABLE public.admin_settings
  ADD COLUMN frq_grader_prompt text;

-- 新表：FRQ 提交与评分历史
CREATE TABLE public.frq_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  paper_id uuid NOT NULL,
  frq_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('exam','practice')),
  answer_text text,
  answer_file_url text,
  answer_file_kind text, -- 'image' | 'pdf' | 'docx' | 'text'
  ai_score integer,
  ai_max_score integer,
  ai_breakdown jsonb,
  ai_overall text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.frq_submissions TO authenticated;
GRANT ALL ON public.frq_submissions TO service_role;
ALTER TABLE public.frq_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own frq submissions" ON public.frq_submissions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own frq submissions" ON public.frq_submissions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
```

### 新增/修改文件
- `src/routes/mock.$slug.tsx`：重写阶段状态机，加模式选择 + 休息屏 + FRQ 作答 + 结果区。
- `src/components/frq/FrqAnswerBox.tsx`：FRQ 作答与上传组件。
- `src/components/frq/FrqGradeCard.tsx`：评分结果展示。
- `src/lib/frq.functions.ts`：`extractFrqImageText`、`gradeFrq`、`getGraderPrompt` 三个 `createServerFn`，都用 `requireSupabaseAuth` + Lovable AI Gateway（`google/gemini-2.5-pro`）。
- `src/lib/ai-gateway.server.ts`：复用现有（若无则新增）provider helper。
- `src/routes/api/admin/grader-prompt.ts`：管理员读写 `admin_settings.frq_grader_prompt` 和 `paper_frqs.image_text / max_score / rubric_note`（沿用现有 admin token 鉴权方式）。
- `src/routes/admin.tsx`：新增 **FRQ 评分** Tab，FRQ 编辑器加按钮和字段。
- `start.ts`：确认 `attachSupabaseAuth` 已挂载（若已存在则不改）。

### 内置默认 grader prompt（中文）
要点：扮演 AP Microeconomics 阅卷官；严格按官方 rubric 逐项判分；列出每个 scoring point 是否得分及原因；最后给总分（分子/分母）；输出 JSON `{ total_score, max_score, breakdown:[{point, awarded:boolean, comment}], overall_comment, suggestions }`；用中文写评语，但保留专业术语英文原文（呼应现有 memory：不缩写术语）。

### 现有 memory 兼容
- 「真题卷解析不得敷衍」memory：MCQ explanation 仍按现有 AI 解析逻辑；FRQ 现在直接由 AI 出完整评分与讲解，符合规则。

---

## 实施顺序（一次性提交）

1. 数据库 migration（新表 + 新列 + RLS + GRANT）。
2. 服务端函数 + admin API。
3. 重写 `mock.$slug.tsx` 状态机与 UI。
4. 管理后台 FRQ Tab 与 FRQ 行内「提取图片文字」按钮。
5. 写一个默认 grader prompt 的 seed（migration 里 `UPDATE admin_settings SET frq_grader_prompt = ...`）。
