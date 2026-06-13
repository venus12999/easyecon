import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { membershipEnvironment } from "@/lib/membership.server";

export const Route = createFileRoute("/api/membership/mock-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const environment = membershipEnvironment(request);
        const { data: isPro } = await supabaseAdmin.rpc("has_active_subscription", { user_uuid: user.userId, check_env: environment });
        if (isPro) return Response.json({ allowed: true, isPro: true });
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { count } = await supabaseAdmin.from("mock_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.userId).gte("created_at", weekAgo);
        return Response.json({ allowed: (count ?? 0) < 1, isPro: false });
      },
    },
  },
});