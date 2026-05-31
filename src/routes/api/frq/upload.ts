import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyUserRequest } from "@/lib/user-auth.server";

const ALLOWED_IMG = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALLOWED_DOC = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const MAX = 10 * 1024 * 1024; // 10MB

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/frq/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return err("unauthorized", 401);
        const form = await request.formData();
        const file = form.get("file");
        const paperId = form.get("paper_id");
        const frqId = form.get("frq_id");
        if (!(file instanceof File)) return err("missing file");
        if (typeof paperId !== "string" || typeof frqId !== "string") return err("missing ids");
        if (file.size > MAX) return err("文件过大（最大 10MB）");
        const isImg = ALLOWED_IMG.has(file.type);
        const isDoc = ALLOWED_DOC.has(file.type);
        if (!isImg && !isDoc) return err("不支持的文件类型");

        const extMap: Record<string, string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
          "application/pdf": "pdf",
          "application/msword": "doc",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
          "text/plain": "txt",
        };
        const ext = extMap[file.type] ?? "bin";
        const path = `frq-answers/${u.userId}/${paperId}/${frqId}/${Date.now()}.${ext}`;

        const { error: upErr } = await supabaseAdmin.storage
          .from("question-images")
          .upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) return err(upErr.message, 500);

        const { data: pub } = supabaseAdmin.storage.from("question-images").getPublicUrl(path);
        return Response.json({
          url: pub.publicUrl,
          kind: isImg ? "image" : ext === "pdf" ? "pdf" : ext === "txt" ? "text" : "doc",
        });
      },
    },
  },
});