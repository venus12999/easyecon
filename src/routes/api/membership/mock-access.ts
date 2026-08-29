import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { isLifetimeVipEmail } from "@/lib/lifetime-vip";
import { membershipEnvironment } from "@/lib/membership.server";

export const Route = createFileRoute("/api/membership/mock-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const examKey = new URL(request.url).searchParams.get("exam_key")?.slice(0, 120) || "full-mock";
        if (isLifetimeVipEmail(user.email)) {
          return Response.json({ allowed: true, isPro: true, nextAvailableAt: null });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const environment = membershipEnvironment(request);
        const { data, error } = await supabaseAdmin.rpc("consume_mock_access", {
          p_user_id: user.userId,
          p_environment: environment,
          p_exam_key: examKey,
        });
        if (error) {
          console.error("Mock access check failed", error);
          return Response.json({ error: "access_check_failed" }, { status: 500 });
        }
        const result = data?.[0];
        return Response.json({
          allowed: result?.allowed === true,
          isPro: result?.is_pro === true,
          nextAvailableAt: result?.next_available_at ?? null,
        });
      },
    },
  },
});