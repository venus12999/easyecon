import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

function unauth() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/feedback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { data, error } = await supabaseAdmin
          .from("feedback")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json({ items: data ?? [] });
      },
      PUT: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { id, status, admin_note } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
        const patch: { status?: "new" | "in_progress" | "resolved"; admin_note?: string } = {};
        if (status && ["new", "in_progress", "resolved"].includes(status)) patch.status = status;
        if (typeof admin_note === "string") patch.admin_note = admin_note;
        const { data, error } = await supabaseAdmin
          .from("feedback")
          .update(patch)
          .eq("id", id)
          .select()
          .single();
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json(data);
      },
      DELETE: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { id } = await request.json();
        if (!id) return new Response(JSON.stringify({ error: "missing id" }), { status: 400 });
        const { error } = await supabaseAdmin.from("feedback").delete().eq("id", id);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        return Response.json({ ok: true });
      },
    },
  },
});