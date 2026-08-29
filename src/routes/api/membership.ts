import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { isLifetimeVipEmail } from "@/lib/lifetime-vip";
import { isPaidSubscriptionActive, membershipEnvironment } from "@/lib/membership.server";

export const Route = createFileRoute("/api/membership")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const environment = membershipEnvironment(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = new Date().toISOString().slice(0, 10);
        const [{ data: subscriptions }, { data: usage }, { data: gift }] = await Promise.all([
          supabaseAdmin.from("subscriptions").select("paddle_subscription_id,paddle_customer_id,price_id,status,current_period_end,cancel_at_period_end,created_at").eq("user_id", user.userId).eq("environment", environment).order("created_at", { ascending: false }),
          supabaseAdmin.from("ai_daily_usage").select("ai_explain_count,frq_grade_count").eq("user_id", user.userId).eq("usage_date", today).maybeSingle(),
          supabaseAdmin.from("membership_adjustments").select("ends_at").eq("user_id", user.userId).lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const subscription = subscriptions?.find((item) => isPaidSubscriptionActive(item)) ?? subscriptions?.[0] ?? null;
        const paidActive = subscription ? isPaidSubscriptionActive(subscription) : false;
        const lifetime = isLifetimeVipEmail(user.email);
        const isPro = paidActive || lifetime || Boolean(gift);
        const source = paidActive ? "paid" : lifetime ? "lifetime" : gift ? "gift" : "free";
        return Response.json({
          isPro,
          plan: subscription?.price_id ?? (lifetime ? "lifetime" : gift ? "gift" : null),
          status: subscription?.status ?? null,
          source,
          currentPeriodEnd: lifetime
            ? null
            : paidActive
              ? subscription?.current_period_end ?? null
              : gift?.ends_at ?? subscription?.current_period_end ?? null,
          cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
          usage: {
            aiExplain: usage?.ai_explain_count ?? 0,
            frqGrade: usage?.frq_grade_count ?? 0,
            aiExplainLimit: isPro ? 30 : 3,
            frqGradeLimit: isPro ? 10 : 1,
          },
          canManage: false,
        });
      },
    },
  },
});