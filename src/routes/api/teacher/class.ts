import { createFileRoute } from "@tanstack/react-router";
import { jsonErr } from "@/lib/json-api";
import { accountNames, ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { normalizeStudentName } from "@/lib/school-exam-session";

async function loadRoster(db: Awaited<ReturnType<typeof getTeacherDb>>, classId: string) {
  const { data: roster } = await db
    .from("school_roster")
    .select("id,student_id,student_name,user_id,created_at")
    .eq("class_id", classId)
    .order("student_id");
  const rows = roster ?? [];
  const rosterIds = rows.map((row) => row.id);
  const { data: attempts } = rosterIds.length
    ? await db.from("school_attempts").select("roster_id").in("roster_id", rosterIds)
    : { data: [] as { roster_id: string }[] };
  const sat = new Set((attempts ?? []).map((row) => row.roster_id));
  const names = await accountNames(db, rows.map((row) => row.user_id));
  return rows.map((row) => ({
    ...row,
    account_name: row.user_id ? names.get(row.user_id) ?? null : null,
    id_locked: !!row.user_id || sat.has(row.id),
  }));
}

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
        return Response.json({ class: cls, roster: await loadRoster(db, cls.id) });
      },
      POST: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as {
          rows?: { student_id: string; student_name: string }[];
          replace?: boolean;
          on_duplicate?: "skip" | "update";
        };
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
        const byId = new Map<string, { student_id: string; student_name: string }>();
        for (const row of cleaned) byId.set(row.student_id, row);
        const unique = [...byId.values()];
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
        const { data: existing } = body.replace
          ? { data: [] as { student_id: string }[] }
          : await db.from("school_roster").select("student_id").eq("class_id", cls.id);
        const existingIds = new Set((existing ?? []).map((row) => row.student_id));
        const duplicates = unique.filter((row) => existingIds.has(row.student_id)).map((row) => row.student_id);
        if (duplicates.length > 0 && body.on_duplicate !== "skip" && body.on_duplicate !== "update") {
          return new Response(JSON.stringify({
            error: "有重复学号。请选择跳过或更新，不会自动改姓名。",
            duplicates,
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        const toWrite = body.on_duplicate === "skip" ? unique.filter((row) => !existingIds.has(row.student_id)) : unique;
        if (toWrite.length > 0) {
          const { error } = await db.from("school_roster").upsert(
            toWrite.map((r) => ({
              class_id: cls.id,
              student_id: r.student_id,
              student_name: r.student_name,
              name_key: normalizeStudentName(r.student_name),
            })),
            { onConflict: "class_id,student_id" },
          );
          if (error) return jsonErr(error.message, 500);
        }
        const added = toWrite.filter((row) => !existingIds.has(row.student_id)).length;
        const updated = body.on_duplicate === "update" ? duplicates.length : 0;
        const skipped = body.on_duplicate === "skip" ? duplicates.length : 0;
        return Response.json({ class: cls, roster: await loadRoster(db, cls.id), added, updated, skipped });
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
        if (owned.student_id !== studentId) {
          if (owned.user_id) return jsonErr("这名学生已经入场，不能再改学号");
          const { count, error: attemptError } = await db
            .from("school_attempts")
            .select("id", { count: "exact", head: true })
            .eq("roster_id", id);
          if (attemptError) return jsonErr(attemptError.message, 500);
          if ((count ?? 0) > 0) return jsonErr("这名学生已经入场，不能再改学号");
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
        return Response.json({ class: cls, roster: await loadRoster(db, cls.id) });
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
        return Response.json({ class: cls, roster: await loadRoster(db, cls.id) });
      },
    },
  },
});
