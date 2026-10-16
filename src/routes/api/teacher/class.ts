import { createFileRoute } from "@tanstack/react-router";
import { jsonErr } from "@/lib/json-api";
import { accountNames, ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { normalizeStudentName } from "@/lib/school-exam-session";

export const Route = createFileRoute("/api/teacher/class")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        if (new URL(request.url).searchParams.get("probe") === "1") {
          return Response.json({ ok: true });
        }
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const { data: roster } = await db
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        const names = await accountNames(db, (roster ?? []).map((row) => row.user_id));
        return Response.json({
          class: cls,
          roster: (roster ?? []).map((row) => ({
            ...row,
            account_name: row.user_id ? names.get(row.user_id) ?? null : null,
          })),
        });
      },
      POST: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
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
          const { data: live } = await db
            .from("school_assignments")
            .select("id")
            .eq("class_id", cls.id)
            .gt("ends_at", new Date().toISOString());
          if (live && live.length > 0) {
            return jsonErr("有未结束的考试，不能覆盖花名册。请用追加导入，或等考试截止后再覆盖。");
          }
          await db.from("school_roster").delete().eq("class_id", cls.id);
        }
        const { error } = await db.from("school_roster").upsert(
          cleaned.map((r) => ({
            class_id: cls.id,
            student_id: r.student_id,
            student_name: r.student_name,
            name_key: normalizeStudentName(r.student_name),
          })),
          { onConflict: "class_id,student_id" },
        );
        if (error) return jsonErr(error.message, 500);
        const { data: roster } = await db
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        return Response.json({ class: cls, roster: roster ?? [] });
      },
      PATCH: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as { id?: string; student_id?: string; student_name?: string };
        const id = String(body.id ?? "").trim();
        const studentId = String(body.student_id ?? "").trim();
        const studentName = String(body.student_name ?? "").trim();
        if (!id || !studentId || !studentName) return jsonErr("学号和姓名都需要填写");
        const { data: owned } = await db
          .from("school_roster")
          .select("id,student_id,user_id")
          .eq("id", id)
          .eq("class_id", cls.id)
          .maybeSingle();
        if (!owned) return jsonErr("找不到这名学生", 404);
        if (owned.user_id && owned.student_id !== studentId) {
          return jsonErr("这名学生已经入场，不能再改学号");
        }
        const { data: clash } = await db
          .from("school_roster")
          .select("id")
          .eq("class_id", cls.id)
          .eq("student_id", studentId)
          .neq("id", id)
          .maybeSingle();
        if (clash) return jsonErr("这个学号已在名册中");
        const { error } = await db
          .from("school_roster")
          .update({
            student_id: studentId,
            student_name: studentName,
            name_key: normalizeStudentName(studentName),
          })
          .eq("id", id)
          .eq("class_id", cls.id);
        if (error) return jsonErr(error.message, 500);
        const { data: roster } = await db
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        return Response.json({ class: cls, roster: roster ?? [] });
      },
      DELETE: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as { id?: string };
        const id = String(body.id ?? "").trim();
        if (!id) return jsonErr("缺少学生");
        const { data: owned } = await db
          .from("school_roster")
          .select("id")
          .eq("id", id)
          .eq("class_id", cls.id)
          .maybeSingle();
        if (!owned) return jsonErr("找不到这名学生", 404);
        const { count, error: attemptError } = await db
          .from("school_attempts")
          .select("id", { count: "exact", head: true })
          .eq("roster_id", id);
        if (attemptError) return jsonErr(attemptError.message, 500);
        if ((count ?? 0) > 0) return jsonErr("这名学生已有考试记录，不能从名册删除");
        const { error } = await db.from("school_roster").delete().eq("id", id).eq("class_id", cls.id);
        if (error) return jsonErr(error.message, 500);
        const { data: roster } = await db
          .from("school_roster")
          .select("id,student_id,student_name,user_id,created_at")
          .eq("class_id", cls.id)
          .order("student_id");
        return Response.json({ class: cls, roster: roster ?? [] });
      },
    },
  },
});
