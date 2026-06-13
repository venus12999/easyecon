import { createFileRoute } from "@tanstack/react-router";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!(await verifyAdminRequest(request))) {
            return new Response(JSON.stringify({ error: "无管理员权限" }), { status: 403 });
          }
          return Response.json({ ok: true });
        } catch {
          return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
        }
      },
    },
  },
});