import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX = 5 * 1024 * 1024; // 5MB

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/admin/upload-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);

        const form = await request.formData();
        const file = form.get("file");
        const questionId = form.get("question_id");

        if (!(file instanceof File)) return err("missing file");
        if (typeof questionId !== "string" || !questionId) return err("missing question_id");
        if (!ALLOWED.has(file.type)) return err("unsupported file type");
        if (file.size > MAX) return err("file too large (max 5MB)");

        const ext = file.type === "image/png" ? "png"
          : file.type === "image/webp" ? "webp"
          : file.type === "image/gif" ? "gif" : "jpg";
        const path = `${questionId}/${Date.now()}.${ext}`;

        const { error: upErr } = await supabaseAdmin.storage
          .from("question-images")
          .upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) return err(upErr.message, 500);

        const { data: pub } = supabaseAdmin.storage.from("question-images").getPublicUrl(path);
        const image_url = pub.publicUrl;

        const { error: updErr } = await supabaseAdmin
          .from("questions")
          .update({ image_url })
          .eq("id", questionId);
        if (updErr) return err(updErr.message, 500);

        return Response.json({ image_url });
      },
      DELETE: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);
        const { id } = await request.json();
        if (!id) return err("missing id");
        const { error } = await supabaseAdmin.from("questions").update({ image_url: null }).eq("id", id);
        if (error) return err(error.message, 500);
        return Response.json({ ok: true });
      },
    },
  },
});
