
# 支付完善计划

四个方向都覆盖。按"用户可感知优先 + 上线阻塞项优先"排序。

## 阶段 1：上线真实支付（阻塞后续所有真金收入）

1. **Readiness / Go Live 状态自检**：调用 `payments--get_go_live_status`，把当前卡在哪一步告诉你，并列出需要你手动完成的 Paddle 侧动作（例如身份验证）。
2. **法律页最后一遍核对**：确保 `/legal/terms`、`/legal/refunds`、`/legal/privacy` 都写清 seller 名称"陈籽言 (Ziyan Chen)"、Paddle MoR 披露、30 天退款窗口、GenAI 相关条款、隐私处理者角色。缺项补齐。
3. **未满 18 岁的替代路径提示**：在 pricing / tutor 页加一个"如无法完成账号验证，仅测试模式可用"的说明（可选，避免用户误以为已经可以真收款）。

## 阶段 2：结账体验优化

1. **结账事件回执**：`usePaddleCheckout` 里挂 `eventCallback`，捕获 `checkout.completed` / `checkout.closed`，成功时立刻 toast "支付成功，正在同步会员权益…"，避免用户以为卡住。
2. **成功回跳后自动刷新会员状态**：`/profile?checkout=success` 与 `/orders?checkout=success` 打开时，轮询 `/api/membership` / `tutor_orders` 3~5 次（每 2s），直到 webhook 落库；期间显示"权益开通中"占位，避免"付了钱看不到会员"的空白窗口。
3. **失败/关闭反馈**：checkout.closed 但未 completed 时提示"未完成支付，可重试"。
4. **未登录点付费按钮**：统一改为跳 `/auth?redirect=<当前路径>`，登录后返回原页面继续付款。
5. **测试模式提示**：确认 `PaymentTestModeBanner` 在 pricing / tutor / profile 顶部出现；文案改为"当前为测试支付环境，不会产生真实扣款"。

## 阶段 3：订单与会员管理

1. **`/orders` 页增强**：
   - 每条订单显示状态徽章（已完成 / 待处理 / 已退款）、金额、币种、时间。
   - 单节续费显示"累计已购 X 节，距离赠送 14 天会员还差 Y 节"。
   - 会员订阅订单区分"付费" / "赠送"来源，展示到期日、是否自动续费。
   - 加"管理订阅 / 更改支付方式 / 取消续费"按钮，走已存在的 `POST /api/membership` → Paddle Customer Portal（新标签打开）。
   - 加"申请退款"按钮，跳 `https://paddle.net`（由 Paddle 官方托管处理）。
2. **管理后台**：在 `/admin` 里新增"订单"Tab，管理员可看到全站 `tutor_orders` + `subscriptions` + `membership_adjustments`，按用户搜索。

## 阶段 4：促销与折扣

1. **优惠码基础设施**：结账时支持传 `discountCode`。
2. **在 pricing / tutor 页加"我有优惠码"输入框**，点付款时把 code 传给 `Paddle.Checkout.open`。
3. **创建首批测试优惠码**（Paddle sandbox）：
   - `WELCOME20`：全场 20% off，单次使用。
   - `TUTOR100`：¥100 off 10 节课包，限 `tutor_pack_10`。
   - 均只在 sandbox 创建；上线后你确认再在 live 复制。
4. **首月/首季度促销位**：pricing 页顶部一条 banner，展示当前生效的优惠码，可一键复制。

---

## 技术细节

- Checkout event callback：`Paddle.Checkout.open({ ..., eventCallback: (e) => { ... } })`，对 `checkout.completed`、`checkout.payment.selected`、`checkout.closed` 分别处理。
- 会员轮询：`useEffect` 检查 URL `?checkout=success`，用 `setInterval` 每 2s 调 `/api/membership`，直到 `isPro=true` 或超时 15s，然后清 URL 参数。
- Customer Portal 打开：现有 `POST /api/membership` 已返回 `url`，前端 `window.open(url, '_blank', 'noopener')`。
- 折扣码状态：本地 `useState`，checkout 时透传；不落库。
- 管理端订单查询：新增 `GET /api/admin/orders`（用 `admin-auth.server` + `supabaseAdmin`），前端在 admin.tsx 新增 tab。
- Paddle 折扣通过 `payments--api_write POST /discounts` 创建，`environment: sandbox`。

---

## 交付顺序

我会一次实现阶段 2 + 3 + 4 的代码（这些是纯软件改动），并在结束时给出阶段 1 的 Go Live 状态清单让你按提示操作。如果你想先只做其中一个阶段，告诉我。
