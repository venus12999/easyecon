/** 人工收款（微信 / 支付宝）可购买的方案目录，前后端共用。 */
export type PayPlanKey =
  | "pro_monthly"
  | "pro_quarterly"
  | "pro_yearly"
  | "tutor_pack_10"
  | "tutor_pack_30"
  | "tutor_single_lesson";

export type PayPlan = {
  key: PayPlanKey;
  label: string;
  kind: "membership" | "tutor";
  /** 单价（人民币元） */
  unitPrice: number;
  /** 是否允许自定义数量 */
  allowQuantity?: boolean;
  maxQuantity?: number;
  /** 会员方案直接开通的天数 */
  membershipDays?: number;
};

export const PAY_PLANS: Record<PayPlanKey, PayPlan> = {
  pro_monthly: { key: "pro_monthly", label: "Pro 月度会员", kind: "membership", unitPrice: 19, membershipDays: 30 },
  pro_quarterly: { key: "pro_quarterly", label: "Pro 季度会员", kind: "membership", unitPrice: 55, membershipDays: 92 },
  pro_yearly: { key: "pro_yearly", label: "Pro 年度会员", kind: "membership", unitPrice: 199, membershipDays: 365 },
  tutor_pack_10: { key: "tutor_pack_10", label: "10 节核心突破课", kind: "tutor", unitPrice: 800 },
  tutor_pack_30: { key: "tutor_pack_30", label: "30 节满分包", kind: "tutor", unitPrice: 3200 },
  tutor_single_lesson: {
    key: "tutor_single_lesson",
    label: "单节续费课",
    kind: "tutor",
    unitPrice: 120,
    allowQuantity: true,
    maxQuantity: 20,
  },
};

export function isPayPlanKey(value: unknown): value is PayPlanKey {
  return typeof value === "string" && value in PAY_PLANS;
}

export function normalizeQuantity(plan: PayPlan, quantity: number) {
  if (!plan.allowQuantity) return 1;
  const max = plan.maxQuantity ?? 20;
  return Math.max(1, Math.min(max, Math.floor(quantity || 1)));
}

export function amountFor(plan: PayPlan, quantity: number) {
  return plan.unitPrice * normalizeQuantity(plan, quantity);
}

/** 该订单赠送的 Pro 会员天数（含辅导课赠送规则）。 */
export function membershipDaysFor(plan: PayPlan, quantity: number) {
  if (plan.kind === "membership") return plan.membershipDays ?? 0;
  if (plan.key === "tutor_pack_10") return 30;
  if (plan.key === "tutor_pack_30") return 90;
  if (plan.key === "tutor_single_lesson" && normalizeQuantity(plan, quantity) >= 5) return 14;
  return 0;
}