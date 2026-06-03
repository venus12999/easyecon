## 目标

把上传的《AP Micro ～ 大题题目集.pdf》里的所有 FRQ（含官方 College Board 评分要点）导入数据库，让用户能在"模拟随机考试"和一个新的"FRQ 专项刷题"页里做这些题，并基于官方 rubric 严格 AI 评分。

---

## 关于 PDF 的事实

- 全本约 30 道 FRQ，覆盖 **Basic Economic Concepts / Factor Markets / Monopoly & Market Failure** 三大类。
- 每题的"AP Scoring Guidelines"已附在题目后面（5–13 分不等，分点写明哪种回答给分）。
- PDF 解析有 50 页限制；后面还有少量内容，需要再分批解析一次拿全。
- 部分题目带图（坐标轴/表格），目前 PDF 抽出的是文字版表格 + 文字描述。

---

## 实施步骤

### 1. 全量解析 PDF（拆成两次，拿到 100% 题目和 rubric）

- 第一次已读到第 50 页（10 道左右已看到 rubric）。
- 把 PDF 拆成两段重新 `parse_document`，得到剩余题目 + rubric。

### 2. 数据结构（沿用现有表，不改 schema）

复用 `mock_papers` + `paper_frqs`：

- 新建 3 条 `mock_papers`，每条对应一个单元分类：
  - `frq-basic-concepts`（基本概念 FRQ 合集）
  - `frq-factor-markets`（要素市场 FRQ 合集）
  - `frq-monopoly`（垄断 & 市场失灵 FRQ 合集）
- 这 3 卷的 MCQ 数量为 0、`frq_seconds` 按题数 × 15 分钟估算，仿真用。
- 每道 FRQ 写入 `paper_frqs`：
  - `content` = 题干原文（**逐字保留英文术语，不缩写**，符合 memory rule）
  - `max_score` = 官方满分（5 / 6 / 7 / 9 / 10 / 11 / 13）
  - `rubric_note` = 官方逐点 rubric（中文双语整理，保留 "1 point for …" 结构）
  - 题干里如出现"如图所示"但 PDF 没有可用图，就在 content 内用文字描述坐标轴/曲线/数值（已经有的部分直接搬，不再造图）

### 3. 让"模拟随机考试"能抽到这些 FRQ

- 修改 `src/routes/mock.random.tsx`：在现有 MCQ 抽样后，再从全部 `paper_frqs` 里随机抽 1–2 题加到 FRQ 阶段，让随机模考真正包含大题。
- 数量上限可调（默认随机 2 题），用现有 FRQ 阶段逻辑评分。

### 4. 新增"FRQ 专项刷题"入口（"刷题"侧）

- 新路由 `src/routes/frq-practice.tsx`：列出全部 FRQ（按单元分组、可按满分排序），点击进入单题作答 + AI 评分页面。
- 复用现有 `FrqAnswerBox` / `FrqGradeCard` / `/api/frq/grade` 端点，无需新建后端。
- 在侧栏 `AppSidebar.tsx` 加一项"大题练习"。

### 5. 升级 FRQ AI 评分 prompt（核心）

把当前 `DEFAULT_PROMPT`（在 `src/routes/api/admin/frqs.ts` 和数据库 `admin_settings.frq_grader_prompt` 中）替换为基于官方 AP rubric 阅读原则的新版本，关键加入：

- **官方 rubric 优先**：题目若带 `rubric_note`，必须**逐条对照**判分，不得自创评分点。
- **AP rubric 通用原则**（来自官方 Reader 规则总结）：
  - One point per rubric bullet — 完整满足才给分，部分满足不给分（除非 rubric 明示半分）。
  - 图形题需检查：曲线方向、相对位置、均衡点、标签、阴影区。**未标注 = 不给分**。
  - 计算题必须"show your work"，仅写答案不给过程分。
  - "Explain" 题需要因果链，仅陈述结论不给解释分。
  - "Identify / State" 题只要结论正确即给分，不要求解释。
- **保留原约束**：术语英文原文不缩写（marginal cost ≠ MC），中文输出，严格 JSON 输出。

更新两处：
- 改 `src/routes/api/admin/frqs.ts` 里的 `DEFAULT_PROMPT` 常量。
- 用 `supabase--insert` 把数据库现有 `admin_settings.frq_grader_prompt` 也更新为新 prompt（这样老题立刻用新规则评分）。

### 6. `/api/frq/grade` 评分调用增强

`grade.ts` 已经把 `rubric_note` 注入到 user message，无需大改。只调一处：**当 `rubric_note` 存在时**，在 user prompt 顶部加一句"以下 rubric 是 College Board 官方评分要点，必须严格逐条对照，不得脱离 rubric 自创评分点"，把 rubric 的权重提到最高。

---

## 技术细节

- **导入方式**：用一个 `supabase--insert` 调用批量 `INSERT` 所有 papers + frqs，content/rubric 用 Postgres dollar-quote 防 SQL 注入。
- **不动 schema**：现有表完全够用，无需 migration。
- **不动 MCQ 题库**：这次只加 FRQ。
- **图片**：PDF 里的图都未单独抽出文件，rubric_note 里用文字交代图形要点（如 "Q at MR=MC, P on demand curve above"），AI 已能据此判分。

---

## 范围之外（这次不做）

- 不改前端整体设计/主题。
- 不重构 mock 流程，只在 random.tsx 里追加 FRQ 抽样。
- 不做 FRQ 图片自动生成 —— 等用户后续如需配图再单独处理。

---

确认这个计划后我就开始执行。
