import type { SupabaseClient } from "@supabase/supabase-js";
import { isLifetimeVipEmail } from "@/lib/lifetime-vip";

export type MembershipEnvironment = "sandbox" | "live";
export type AiQuotaKind = "ai_explain" | "frq_grade";
export type AiQuotaResult = { allowed: boolean; used: number; quota: number; is_pro: boolean };

export type SubscriptionSummary = {
  status: string;
  current_period_end: string | null;
};

export function isPaidSubscriptionActive(subscription: SubscriptionSummary, now = Date.now()) {
  const periodActive = !subscription.current_period_end || new Date(subscription.current_period_end).getTime() > now;
  return periodActive && (
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "canceled"
  );
}

export function membershipEnvironment(request: Request): MembershipEnvironment {
  const host = new URL(request.url).hostname;
  return host.includes("preview") || host.includes("-dev.") || host.endsWith(".lovableproject.com") || host === "localhost" || host === "127.0.0.1"
    ? "sandbox"
    : "live";
}

async function consumeLifetimeProQuota(
  supabaseAdmin: SupabaseClient,
  userId: string,
  kind: AiQuotaKind,
): Promise<AiQuotaResult> {
  const quota = kind === "ai_explain" ? 30 : 10;
  const column = kind === "ai_explain" ? "ai_explain_count" : "frq_grade_count";
  const today = new Date().toISOString().slice(0, 10);
  const { error: upsertError } = await supabaseAdmin.from("ai_daily_usage").upsert(
    { user_id: userId, usage_date: today },
    { onConflict: "user_id,usage_date", ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;
  const { data: row, error: readError } = await supabaseAdmin
    .from("ai_daily_usage")
    .select("ai_explain_count,frq_grade_count")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .maybeSingle();
  if (readError) throw readError;
  const used = (kind === "ai_explain" ? row?.ai_explain_count : row?.frq_grade_count) ?? 0;
  if (used >= quota) return { allowed: false, used, quota, is_pro: true };
  const next = used + 1;
  const { error: updateError } = await supabaseAdmin
    .from("ai_daily_usage")
    .update({ [column]: next })
    .eq("user_id", userId)
    .eq("usage_date", today)
    .eq(column, used);
  if (updateError) throw updateError;
  return { allowed: true, used: next, quota, is_pro: true };
}

export async function consumeAiQuota(
  supabaseAdmin: SupabaseClient,
  userId: string,
  kind: AiQuotaKind,
  environment: MembershipEnvironment,
  email?: string | null,
) {
  if (isLifetimeVipEmail(email)) {
    return consumeLifetimeProQuota(supabaseAdmin, userId, kind);
  }
  const { data, error } = await supabaseAdmin.rpc("consume_ai_quota", {
    p_user_id: userId,
    p_kind: kind,
    p_environment: environment,
  });
  if (error) throw error;
  const result = data?.[0] as AiQuotaResult | undefined;
  if (!result) throw new Error("Unable to check AI quota");
  return result;
}

export async function releaseAiQuota(
  supabaseAdmin: SupabaseClient,
  userId: string,
  kind: AiQuotaKind,
) {
  const { error } = await supabaseAdmin.rpc("release_ai_quota", {
    p_user_id: userId,
    p_kind: kind,
  });
  if (error) console.error("Failed to release AI quota", { userId, kind, message: error.message });
}