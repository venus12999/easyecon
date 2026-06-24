# EasyEcon 软件总体规划 / 总览

> 文档版本：2025-07  
> 本文档描述产品的整体形态，不含支付实现细节（另见支付专项 plan）。

---

## 一、核心定位

**EasyEcon** 是一款面向中国 AP 微观经济学考生的英文刷题与备考平台。核心价值主张：

- 用**中文引导**帮助中国学生突破语言壁垒，理解英文原题；
- 提供**中英对照术语速查**，解决经济学术语混淆问题；
- 覆盖 AP Microeconomics 全部 6 个 Unit 的 **MCQ + FRQ** 完整刷题闭环；
- 内置 **AI 追问答疑**（流式 SSE），支持对题目逐一深度探讨；
- 模拟真实 AP 考试流程（MCQ 定时 → Break → FRQ 定时）的**全真模考**；
- 提供 **Pro 会员**订阅（Paddle 支付），解锁更高 AI 配额。

---

## 二、面向用户

| 用户角色 | 描述 |
|---|---|
| **普通学生（游客）** | 可浏览题库、进行有限刷题练习，本地存储错题 |
| **注册学生** | 云端同步答题进度、错题本、AI 答疑基础额度（ai_explain 3次/天，frq_grade 1次/天） |
| **Pro 会员学生** | AI 答疑提升至 30 次/天，FRQ 评分 10 次/天，不限次模考 |
| **管理员** | 通过独立登录（JWT 角色校验）访问后台，管理题库、术语、FRQ、用户、反馈；支持 AI 批量分析题目 |

---

## 三、主要功能模块

### 3.1 练习刷题（Practice）
- **路由**：`/practice/$slug`（slug = knowledge_point.slug）
- 按**知识点**（knowledge_point）选题，支持按题型筛选：`basic`（基础概念）、`application`（情境应用）、`pitfall`（高频易错）
- 题目卡片：题干（支持图片）、4-5 选项、提交后即时评分 + 彩色解析 + `pitfall_note` 警示
- 术语高亮：题干和选项中的术语词自动 tooltip 展示中文释义
- 进度追踪：多轮练习感知（每轮覆盖该 KP 所有题目后进入下一轮）
- **错题加入**：答错或手动收藏自动存入错题本

### 3.2 大题练习（FRQ）
- **路由**：`/frq`（分类入口）、`/mock/$slug?frq=...`（题目作答）
- 按 AP 官方 6 个 Unit 分类，题目来自 `paper_frqs` 表（挂载在 `frq-pdf-practice` 纸卷）
- 学生手写文本回答（FrqAnswerBox），提交后调用 `/api/frq/grade`（AI 评分）
- 支持上传图片附件（`/api/frq/upload`），回答中可插入图表
- **AI 按得分点评分**：返回每个 sub-part 得分、总分、点评（FrqGradeCard）

### 3.3 模拟考试（Mock）
- **路由**：`/mock`（卷库列表）、`/mock/random`（随机模考）、`/mock/$slug`（真题卷）
- 真题卷库（`mock_papers` 表），每卷含 MCQ 部分 + FRQ 部分
- 考试流程：`idle` → `running`（MCQ 定时）→ `break`（官方 10 min 休息）→ `frq`（FRQ 定时）→ `done`（结果报告）
- 答题工具栏：荧光笔标注、计算器浮窗、pin 标记题目、删除线划选项
- 模考结束后展示分题得分、分 Unit 正确率统计

### 3.4 AI 答疑（AskAI）
- **路由（API）**：`/api/ai-explain`（POST，流式 SSE）
- 在 `practice` 每道题提交后可追问，携带题干 + 选项 + 正确答案 + 解析作为上下文
- 需登录；调用前通过 `consume_ai_quota` 检查/消费每日配额
- 流式返回（OpenAI-compatible delta），前端逐字展示

### 3.5 错题本（Wrong Book）
- **路由**：`/wrong`
- 支持游客（localStorage）和登录用户（`wrong_questions` 表，来源 `practice` / `mock`）
- 按 Unit、来源（练习/模考）筛选；支持从错题本移除
- 内嵌折线面积图（Recharts），按时间区间（7/30/90/全部天）展示答题正确率趋势

### 3.6 术语速查（Terms）
- **路由**：`/terms`
- 全量展示 `terms` 表，支持中英文关键词搜索
- 展示：英文术语、中文译名、定义、易混词列表

### 3.7 个人资料与会员（Profile）
- **路由**：`/profile`
- 修改显示名、邮箱、密码
- 展示会员状态（isPro、plan、当前周期截止日、cancel_at_period_end）、今日 AI 配额用量
- Pro 会员通过 Paddle 购买（月付 ¥29 / 年付 ¥199），支持管理员礼赠（`membership_adjustments`）

### 3.8 管理后台（Admin）
- **路由**：`/admin`（单页多 Tab SPA），通过 `/api/admin/login` 校验 Supabase JWT + 服务端角色
- **Tab 列表**：
  - **题目管理**：增删改查 MCQ 题目（含 AI 批量分析 `/api/admin/reanalyze`）、一键发布/草稿切换、图片上传（Cloudflare R2）
  - **FRQ 管理**：增删改 FRQ 大题及子 part
  - **知识点管理**：管理 knowledge_points（slug、中英文名、Unit、排序）
  - **术语管理**：管理 terms 表
  - **批量导入**：CSV/文本导入 MCQ 题目（`/api/admin/import`）
  - **反馈管理**：查看 feedback 列表，更新状态/备注
  - **用户管理**：查看用户列表、订阅、手动赠送会员天数
  - **审计日志**：操作日志查询（`/api/admin/audit`）

### 3.9 反馈组件（Feedback Widget）
- 悬浮按钮，任何页面可提交 Bug 或建议
- 写入 `feedback` 表（任何人可 INSERT，无 public SELECT）

### 3.10 合规页面
- `/legal/privacy`——隐私政策
- `/legal/terms`——服务条款
- `/legal/refunds`——退款政策
- `/pricing`——定价页

---

## 四、路由结构

```
/                        首页（知识点列表 + 打卡 + 快速入口）
/auth                    登录 / 注册
/reset-password          重置密码
/profile                 个人资料 + 会员管理
/pricing                 定价页

/terms                   术语速查
/practice/$slug          知识点刷题（MCQ）
/wrong                   错题本

/frq                     FRQ 大题分类
/mock                    模考首页（卷库）
/mock/random             随机模考
/mock/$slug              真题卷 / FRQ 单题作答

/admin                   管理后台

/legal/privacy           隐私政策
/legal/terms             服务条款
/legal/refunds           退款政策

── API 端点 ──
/api/ai-explain          AI 答疑（流式 SSE）
/api/frq/grade           FRQ AI 评分
/api/frq/upload          FRQ 附件上传
/api/membership          查询当前用户会员状态
/api/membership/mock-access  检查模考访问权限
/api/feedback            提交反馈
/api/admin/*             管理后台专用接口（需 JWT 角色）
/api/public/payments/webhook  Paddle Webhook
```

---

## 五、数据模型概览

### 核心内容表

| 表 | 说明 |
|---|---|
| `knowledge_points` | 知识点：unit、slug、name_en/zh、sort_order |
| `questions` | MCQ 题目：type(basic/application/pitfall)、difficulty、stem、option_a-e、correct_answer、explanation、pitfall_note、term_tags、status(draft/published)、image_url |
| `terms` | 术语：term_en/zh、definition、confusable_with、unit |
| `mock_papers` | 模考卷：slug、title、year、total_seconds、frq_seconds、break_seconds |
| `paper_questions` | 卷-题关联（MCQ） |
| `paper_frqs` | 卷-FRQ 关联：content、max_score、sort_order、image_url/text |

### 用户行为表

| 表 | 说明 |
|---|---|
| `profiles` | 用户资料：display_name（触发器自动创建） |
| `answer_attempts` | 答题记录：question_id、picked_answer、is_correct、mode(practice/mock) |
| `wrong_questions` | 错题本：(user_id, question_id, source) 复合主键 |

### 会员与配额表

| 表 | 说明 |
|---|---|
| `subscriptions` | Paddle 订阅：paddle_subscription_id、status、current_period_end、environment(sandbox/live) |
| `ai_daily_usage` | 每日 AI 用量：ai_explain_count、frq_grade_count（唯一索引 user_id+usage_date） |
| `membership_adjustments` | 管理员礼赠：days_granted、starts_at、ends_at |

### 运营表

| 表 | 说明 |
|---|---|
| `feedback` | 用户反馈：category(bug/suggestion)、status(new/in_progress/resolved)、admin_note |
| `admin_settings` | 管理员单行配置（password_hash） |

### 关键数据库函数

- `has_active_subscription(user_uuid, check_env)` — 判断用户当前是否 Pro
- `consume_ai_quota(user_id, kind, environment)` — 原子消费 AI 配额，返回 allowed/used/quota/is_pro
- `release_ai_quota(user_id, kind)` — 请求失败时回滚配额

---

## 六、技术栈

| 层 | 技术 |
|---|---|
| **前端框架** | React 19 + TanStack Start（TanStack Router 文件路由）|
| **构建工具** | Vite 7 + Cloudflare Vite Plugin |
| **运行时** | Cloudflare Workers（wrangler.jsonc；Nitro 适配器） |
| **UI 组件** | shadcn/ui（Radix UI primitives + Tailwind CSS v4）|
| **图表** | Recharts |
| **表单** | React Hook Form + Zod |
| **BaaS** | Supabase（Auth、PostgreSQL + RLS、Edge Functions 替代为本地 API 路由）|
| **AI 服务** | OpenAI-compatible API（流式 SSE，server-side proxy）|
| **支付** | Paddle（Billing SDK + Webhook） |
| **文件存储** | Cloudflare R2（题目图片上传）|
| **状态管理** | React 本地 state（无全局状态库）|
| **音效** | 自定义 `sfx.ts`（答对/答错音效）|

---

## 七、题目内容覆盖（AP Micro Units）

| Unit | 知识点（部分） |
|---|---|
| Unit 2 | Demand, Supply, Market Equilibrium, Price Elasticity, Consumer/Producer Surplus, Government Intervention |
| Unit 3 | 完全竞争、垄断、寡头、垄断竞争（生产与成本全套）|
| Unit 4 | 不完全竞争市场 |
| Unit 5 | Factor Markets（要素市场：派生需求、MRP、买方垄断）|
| Unit 6 | Externalities, Public Goods, Inequality, Government Intervention |

---

## 八、设计特点与运营考量

1. **中文优先体验**：页面文案全中文，术语 tooltip 实时对照，解析含中文经济学表述。
2. **离线降级**：未登录用户通过 localStorage 保存错题和本地答题记录，鼓励注册同步。
3. **打卡激励**：首页展示本周7日打卡格，今日答题即标记；今日正确率实时显示。
4. **多环境会员**：sandbox（preview/localhost）与 live（生产域名）完全隔离，同一 DB 字段 `environment` 区分。
5. **FRQ 图片支持**：FRQ 题目和答题均支持图片，图片由 R2 存储，URL 写入 DB。
6. **吉祥物**：`FloatingMascot` 浮动组件，作为品牌视觉元素。
