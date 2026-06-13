import type { SupabaseClient } from "@supabase/supabase-js";

export type MembershipEnvironment = "sandbox" | "live";
export type AiQuotaKind = "ai_explain" | "frq_grade";

export function membershipEnvironment(request: Request): MembershipEnvironment {
  const host = new URL(request.url).hostname;
  return host.includes("preview") || host.includes("-dev.") || host === "localhost" ? "sandbox" : "live";
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