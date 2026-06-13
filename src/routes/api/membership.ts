import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { membershipEnvironment } from "@/lib/membership.server";

function isCurrent(status: string, periodEnd: string | null) {
  if (!["active", "trialing", "past_due", "canceled"].includes(status)) return false;
  return !periodEnd || new Date(periodEnd).getTime() > Date.now();
}

export const Route = createFileRoute("/api/membership")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const environment = membershipEnvironment(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = new Date().toISOString().slice(0, 10);
        const [{ data: subscription }, { data: usage }, { data: gift }] = await Promise.all([
          supabaseAdmin.from("subscriptions").select("paddle_subscription_id,paddle_customer_id,price_id,status,current_period_end,cancel_at_period_end").eq("user_id", user.userId).eq("environment", environment).order("created_at", { ascending: false }).limit(1).maybeSingle(),
          supabaseAdmin.from("ai_daily_usage").select("ai_explain_count,frq_grade_count").eq("user_id", user.userId).eq("usage_date", today).maybeSingle(),
          supabaseAdmin.from("membership_adjustments").select("ends_at").eq("user_id", user.userId).lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const paidActive = subscription ? isCurrent(subscription.status, subscription.current_period_end) : false;
        const isPro = paidActive || Boolean(gift);
        return Response.json({
          isPro,
          plan: subscription?.price_id ?? (gift ? "gift" : null),
          status: subscription?.status ?? null,
          currentPeriodEnd: subscription?.current_period_end ?? gift?.ends_at ?? null,
          cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
          usage: {
            aiExplain: usage?.ai_explain_count ?? 0,
            frqGrade: usage?.frq_grade_count ?? 0,
            aiExplainLimit: isPro ? 30 : 3,
            frqGradeLimit: isPro ? 10 : 1,
          },
          canManage: Boolean(subscription?.paddle_customer_id),
        });
      },
      POST: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const environment = membershipEnvironment(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: subscription } = await supabaseAdmin.from("subscriptions").select("paddle_subscription_id,paddle_customer_id").eq("user_id", user.userId).eq("environment", environment).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!subscription) return Response.json({ error: "subscription not found" }, { status: 404 });
        const { getPaddleClient } = await import("@/lib/paddle.server");
        const session = await getPaddleClient(environment).customerPortalSessions.create(subscription.paddle_customer_id, [subscription.paddle_subscription_id]);
        return Response.json({ url: session.urls.general.overview });
      },
    },
  },
});