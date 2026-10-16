import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { jsonErr } from "@/lib/json-api";
import { accountNames, ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { isUuid } from "@/lib/school-exam-session";
import { attachSchoolAiGrades, closeSchoolAttempt, saveManualFrqScores, teacherFrqViews, teacherMcqViews } from "@/lib/school-exam.server";

async function teacherAssignment(userId: string, jwt: string, assignmentId: string) {
  const db = await getTeacherDb(jwt);
  const cls = await ensureTeacherClass(userId, db);
  if (!isUuid(assignmentId)) return null;
  const { data: assignment } = await db
    .from("school_assignments")
    .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id,class_id")
    .eq("id", assignmentId)
    .eq("class_id", cls.id)
    .maybeSingle();
  return assignment ? { db, assignment } : null;
}

export const Route = createFileRoute("/api/teacher/gradebook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const assignmentId = new URL(request.url).searchParams.get("assignment_id") ?? "";
        const owned = await teacherAssignment(u.userId, u.jwt, assignmentId);
        if (!owned) return jsonErr(isUuid(assignmentId) ? "not found" : "missing assignment_id", isUuid(assignmentId) ? 404 : 400);
        const { db, assignment } = owned;
        const [{ data: roster }, { data: attempts }, { data: paper }, { data: frqs }, { data: questions }] = await Promise.all([
          db.from("school_roster").select("id,student_id,student_name,user_id").eq("class_id", assignment.class_id).order("student_id"),
          db
            .from("school_attempts")
            .select("id,roster_id,user_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers")
            .eq("assignment_id", assignmentId),
          db.from("mock_papers").select("id,slug,title").eq("id", assignment.paper_id).maybeSingle(),
          supabaseAdmin.from("paper_frqs").select("id,title,sort_order,max_score").eq("paper_id", assignment.paper_id).order("sort_order"),
          supabaseAdmin
            .from("paper_questions")
            .select("sort_order,question_id,questions!inner(correct_answer)")
            .eq("paper_id", assignment.paper_id)
            .order("sort_order", { ascending: true }),
        ]);
        const mcqPaper = ((questions ?? []) as unknown as Array<{ sort_order: number; question_id: string; questions: { correct_answer: string | null } }>).map((row) => ({
          question_id: row.question_id,
          sort_order: row.sort_order,
          correct_answer: row.questions?.correct_answer ?? null,
        }));
        const submittedUsers = (attempts ?? []).filter((a) => a.submitted_at && a.user_id).map((a) => a.user_id as string);
        const { data: submissions } = submittedUsers.length
          ? await supabaseAdmin
              .from("frq_submissions")
              .select("user_id,frq_id,ai_score,ai_max_score,ai_overall,ai_suggestions,ai_breakdown,created_at")
              .eq("paper_id", assignment.paper_id)
              .in("user_id", submittedUsers)
              .is("archived_at", null)
              .order("created_at", { ascending: false })
          : { data: [] as { user_id: string; frq_id: string; ai_score: number | null; ai_max_score: number | null; ai_overall: string | null; ai_suggestions: string | null; ai_breakdown: Json; created_at: string }[] };
        const byUser = new Map<string, NonNullable<typeof submissions>>();
        for (const row of submissions ?? []) {
          const list = byUser.get(row.user_id) ?? [];
          list.push(row);
          byUser.set(row.user_id, list);
        }
        const attemptMap = new Map((attempts ?? []).map((a) => [a.roster_id, a]));
        const names = await accountNames(db, (roster ?? []).map((row) => row.user_id));
        const rows = (roster ?? []).map((r) => {
          const a = attemptMap.get(r.id);
          const views = a ? teacherFrqViews(a.frq_answers, frqs ?? [], a.user_id ? byUser.get(a.user_id) ?? [] : []) : [];
          const mcqs = a ? teacherMcqViews(mcqPaper, a.mcq_detail) : [];
          const scored = views.filter((v) => (v.manual_score ?? v.ai_score) != null);
          return {
            roster_id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            account_name: r.user_id ? names.get(r.user_id) ?? null : null,
            started_at: a?.started_at ?? null,
            submitted_at: a?.submitted_at ?? null,
            mcq_total: a?.submitted_at ? a.mcq_total : null,
            mcq_correct: a?.submitted_at ? a.mcq_correct : null,
            duration_seconds: a?.duration_seconds ?? null,
            frq_answers: Object.fromEntries(views.map((v) => [v.frq_id, { text: v.answer_text, fileUrl: v.file_url }])),
            mcqs,
            frqs: views,
            frq_score: scored.length ? views.reduce((sum, v) => sum + (v.manual_score ?? v.ai_score ?? 0), 0) : null,
            frq_max: views.reduce((sum, v) => sum + v.max_score, 0),
            status: a?.submitted_at ? "submitted" : a ? "in_progress" : "missing",
          };
        });
        return Response.json({ assignment: { ...assignment, paper }, rows });
      },

      POST: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const body = (await request.json()) as {
          assignment_id?: string;
          roster_id?: string;
          action?: string;
          manual?: Record<string, number | null>;
        };
        const assignmentId = body.assignment_id ?? "";
        const rosterId = body.roster_id ?? "";
        if (!isUuid(assignmentId)) return jsonErr("missing fields");
        if (body.action !== "end" && !isUuid(rosterId)) return jsonErr("missing fields");
        const owned = await teacherAssignment(u.userId, u.jwt, assignmentId);
        if (!owned) return jsonErr("not found", 404);
        if (body.action === "end") {
          const endedAt = new Date(Date.now() - 1000).toISOString();
          const { error: endError } = await supabaseAdmin.from("school_assignments").update({ ends_at: endedAt }).eq("id", assignmentId);
          if (endError) return jsonErr(endError.message, 500);
          const { data: openAttempts } = await supabaseAdmin
            .from("school_attempts")
            .select("id")
            .eq("assignment_id", assignmentId)
            .is("submitted_at", null);
          for (const row of openAttempts ?? []) await closeSchoolAttempt(row.id, owned.assignment.paper_id);
          return Response.json({ ok: true, ends_at: endedAt });
        }
        const { data: attempt } = await supabaseAdmin
          .from("school_attempts")
          .select("id,frq_answers,submitted_at")
          .eq("assignment_id", assignmentId)
          .eq("roster_id", rosterId)
          .maybeSingle();
        if (!attempt) return jsonErr("学生还没开始");
        if (body.action === "collect") {
          if (attempt.submitted_at) return Response.json({ ok: true });
          await closeSchoolAttempt(attempt.id, owned.assignment.paper_id);
          return Response.json({ ok: true });
        }
        if (!attempt.submitted_at) return jsonErr("学生还没交卷");
        const next = body.action === "ai"
          ? await attachSchoolAiGrades(owned.assignment.paper_id, attempt.frq_answers, { force: true })
          : await saveManualFrqScores(owned.assignment.paper_id, attempt.frq_answers, body.manual ?? {});
        const { error } = await supabaseAdmin.from("school_attempts").update({ frq_answers: next }).eq("id", attempt.id);
        if (error) return jsonErr(error.message, 500);
        return Response.json({ ok: true });
      },
    },
  },
});
