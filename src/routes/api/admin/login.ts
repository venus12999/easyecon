import { createFileRoute } from "@tanstack/react-router";
import { signToken } from "@/lib/admin-token.server";
import { isAdminEmailServer } from "@/lib/admin-emails.server";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/admin/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
          const jwt = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
          if (!jwt) {
            return new Response(JSON.stringify({ error: "请先登录账号" }), { status: 401 });
          }
          const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
          const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          if (!url || !anon) {
            return new Response(JSON.stringify({ error: "服务端未配置" }), { status: 500 });
          }
          const sb = createClient(url, anon, { auth: { persistSession: false } });
          const { data, error } = await sb.auth.getUser(jwt);
          if (error || !data.user) {
            return new Response(JSON.stringify({ error: "登录已失效，请重新登录" }), { status: 401 });
          }
          if (!isAdminEmailServer(data.user.email)) {
            return new Response(JSON.stringify({ error: "无管理员权限" }), { status: 403 });
          }
          return Response.json({ token: signToken() });
        } catch {
          return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
        }
      },
    },
  },
});