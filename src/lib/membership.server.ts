import type { SupabaseClient } from "@supabase/supabase-js";

export type MembershipEnvironment = "sandbox" | "live";
export type AiQuotaKind = "ai_explain" | "frq_grade";

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
  return host.includes("preview") || host.includes("-dev.") || host.endsWith(".lovableproject.com") || host === "localhost"
    ? "sandbox"
    : "live";
}

export async function consumeAiQuota(
  supabaseAdmin: SupabaseClient,
  userId: string,
  kind: AiQuotaKind,
  environment: MembershipEnvironment,
) {
  const { data, error } = await supabaseAdmin.rpc("consume_ai_quota", {
    p_user_id: userId,
    p_kind: kind,
    p_environment: environment,
  });
  if (error) throw error;
  const result = data?.[0] as { allowed: boolean; used: number; quota: number; is_pro: boolean } | undefined;
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