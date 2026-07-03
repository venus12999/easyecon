import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";

export const Route = createFileRoute("/api/tutor/taken-slots")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const url = new URL(request.url);
        const teacher = (url.searchParams.get("teacher") ?? "").slice(0, 60);
        const day = (url.searchParams.get("day") ?? "").slice(0, 10);
        if (!teacher || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          return Response.json({ error: "invalid_params" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const start = `${day}T00:00:00.000Z`;
        const endDate = new Date(`${day}T00:00:00.000Z`);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        const end = endDate.toISOString();
        const { data, error } = await supabaseAdmin
          .from("tutor_trial_bookings")
          .select("scheduled_at")
          .eq("teacher", teacher)
          .not("scheduled_at", "is", null)
          .gte("scheduled_at", start)
          .lt("scheduled_at", end);
        if (error) return Response.json({ error: "query_failed" }, { status: 500 });
        return Response.json({ slots: (data ?? []).map((r) => r.scheduled_at) });
      },
    },
  },
});