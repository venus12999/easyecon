# 改用微信 / 支付宝收款（移除 Paddle）

分两步走：**先上「收款码 + 手动开通」，当天就能真收钱**；随后接入 Lovable 内置 Stripe，让支付宝/微信支付自动化。Paddle 相关代码全部移除。

## 第 0 步：需要你手动做的一件事

Paddle 是 Lovable 托管的支付商，我无法用工具断开。请在 Payments 面板右上角三点菜单里点 **Disconnect Paddle**。断开后现有测试订阅/价格不会保留（本来也都是测试数据）。

## 第 1 步：收款码 + 手动开通（立即可收钱）

用户流程：
1. 在 `/pricing`（会员）或 `/tutor`（课包）点「微信/支付宝支付」。
2. 弹窗显示对应金额 + 你的微信/支付宝收款码（两张图片，你提供），并显示一个订单号。
3. 用户付款后上传付款截图 + 填写付款账号备注，提交。
4. 你在 `/admin` 新增的「收款审核」Tab 里看到待审订单，点「通过」即自动开通对应权益；也可「驳回」并写原因。
5. 用户在 `/orders` 看到状态：待审核 / 已开通 / 已驳回，并收到页面提示。

权益规则沿用现有逻辑：
- 月度 ¥19 / 季度 ¥55 / 年度 ¥199 → 写入 `membership_adjustments`（30 / 90 / 365 天）。
- 10 节课包 → 送 30 天会员；30 节满分包 → 送 90 天；单节续费满 5 节 → 送 14 天。
- 课包本身仍记入 `tutor_orders`，供 `/orders` 与教师后台使用。

## 第 2 步：接入内置 Stripe（自动化支付宝/微信）

断开 Paddle 后启用 Lovable 内置 Stripe，重新建立商品与价格，改造结账为 Stripe Checkout，并开启 Alipay / WeChat Pay 支付方式（一次性付款支持；会员按「按周期一次性购买」处理，避免自动续费对支付宝/微信的限制）。webhook 落库后自动开通权益，人工审核通道保留作为兜底。

Stripe 仍需身份验证（未满 18 需监护人信息）——这是所有正规收款渠道的硬要求；第 1 步的收款码通道不受此限制。

---

## 技术细节

- 新表 `manual_payments`：`id, user_id, order_no, kind('membership'|'tutor'), plan_key, quantity, amount_cny, channel('wechat'|'alipay'), proof_path, payer_note, status('pending'|'approved'|'rejected'), review_note, reviewed_by, reviewed_at, created_at`。RLS：用户仅可 insert/select 自己的行；审核更新走 service role。建表同迁移内写 GRANT。
- 新增私有 storage bucket `payment-proofs`，用户只能写入自己 `user_id/` 前缀，读取通过管理端签名 URL。
- 新增 `src/routes/api/manual-payments.ts`（用户提交 / 查询）与 `src/routes/api/admin/manual-payments.ts`（列表 / 审核，走 `admin-auth.server` + `supabaseAdmin`），审核通过时写 `membership_adjustments` 与 `tutor_orders`。
- 新增 `src/components/ManualPayDialog.tsx`，收款码图片放 `src/assets/`（需要你上传两张二维码）。
- 删除：`src/lib/paddle.ts`、`src/lib/paddle.server.ts`、`src/lib/payments.functions.ts`、`src/hooks/use-paddle-checkout.ts`、`src/components/PaymentTestModeBanner.tsx`、`src/routes/api/public/payments/webhook.ts`；清理 `pricing.tsx`、`tutor.tsx`、`profile.tsx`、`orders.tsx`、`api/membership.ts` 中的 Paddle 引用（客户门户按钮改为「联系客服」）。
- `subscriptions` 表与 `has_active_subscription` 保留（Stripe 阶段复用），`membership_adjustments` 继续作为手动开通载体，`/api/membership` 判定逻辑不变。
- 法律页把「Paddle 作为 Merchant of Record」改为直接由陈籽言 (Ziyan Chen) 收款，退款窗口保持 30 天；接入 Stripe 后再改为 Stripe 表述。

## 需要你提供

1. 微信收款码图片、支付宝收款码图片。
2. 断开 Paddle 的确认。
