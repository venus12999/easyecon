import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonErr } from "@/lib/json-api";
import { ensureTeacherClass, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { normalizeStudentName } from "@/lib/school-exam-session";

export const Route = createFileRoute("/api/teacher/class")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const cls = await ensureTeacherClass(u.userId);
        const { data: roster } = await supabaseAdmin
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        return Response.json({ class: cls, roster: roster ?? [] });
      },
      POST: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const cls = await ensureTeacherClass(u.userId);
        const body = (await request.json()) as { rows?: { student_id: string; student_name: string }[]; replace?: boolean };
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (rows.length === 0) return jsonErr("花名册不能为空");
        if (rows.length > 200) return jsonErr("单次最多导入 200 人");
        const cleaned = rows
          .map((r) => ({
            student_id: String(r.student_id ?? "").trim(),
            student_name: String(r.student_name ?? "").trim(),
          }))
          .filter((r) => r.student_id && r.student_name);
        if (cleaned.length === 0) return jsonErr("没有有效的学号/姓名");
        if (body.replace) {
          await supabaseAdmin.from("school_roster").delete().eq("class_id", cls.id);
        }
        const { error } = await supabaseAdmin.from("school_roster").upsert(
          cleaned.map((r) => ({
            class_id: cls.id,
            student_id: r.student_id,
            student_name: r.student_name,
            name_key: normalizeStudentName(r.student_name),
          })),
          { onConflict: "class_id,student_id" },
        );
        if (error) return jsonErr(error.message, 500);
        const { data: roster } = await supabaseAdmin
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        return Response.json({ class: cls, roster: roster ?? [] });
      },
    },
  },
});
