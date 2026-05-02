import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const category = body?.category === "suggestion" ? "suggestion" : "bug";
          const message = typeof body?.message === "string" ? body.message.trim() : "";
          const page_url = typeof body?.page_url === "string" ? body.page_url.slice(0, 500) : null;
          const contact = typeof body?.contact === "string" ? body.contact.slice(0, 200) : null;
          if (!message || message.length > 4000) {
            return new Response(JSON.stringify({ error: "内容长度不合法" }), { status: 400 });
          }
          const { error } = await supabaseAdmin
            .from("feedback")
            .insert({ category, message, page_url, contact });
          if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
          return Response.json({ ok: true });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "提交失败" }),
            { status: 400 },
          );
        }
      },
    },
  },
});