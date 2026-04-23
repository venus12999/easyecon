import { createFileRoute } from "@tanstack/react-router";
import { signToken } from "@/lib/admin-token.server";

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { password } = (await request.json()) as { password?: string };
          const expected = process.env.ADMIN_PASSWORD;
          if (!expected) {
            return new Response(JSON.stringify({ error: "未配置管理员密码" }), { status: 500 });
          }
          if (!password || password !== expected) {
            return new Response(JSON.stringify({ error: "wrong password" }), { status: 401 });
          }
          return Response.json({ token: signToken() });
        } catch {
          return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
        }
      },
    },
  },
});