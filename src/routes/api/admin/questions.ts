import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

function unauth() {
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/admin/questions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { data: kps } = await supabaseAdmin
          .from("knowledge_points")
          .select("id,slug,name_en,name_zh,unit")
          .order("sort_order");
        const { data: questions } = await supabaseAdmin
          .from("questions")
          .select("*")
          .order("created_at", { ascending: false });
        return Response.json({ knowledge_points: kps ?? [], questions: questions ?? [] });
      },
      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const body = await request.json();
        const { id, ...payload } = body;
        const { data, error } = await supabaseAdmin.from("questions").insert(payload).select().single();
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json(data);
      },
      PUT: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { id, ...payload } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
        const { data, error } = await supabaseAdmin.from("questions").update(payload).eq("id", id).select().single();
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json(data);
      },
      DELETE: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { id } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
        const { error } = await supabaseAdmin.from("questions").delete().eq("id", id);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json({ ok: true });
      },
    },
  },
});