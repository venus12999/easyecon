import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { jsonErr } from "@/lib/json-api";
import { accountNames, ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { isUuid } from "@/lib/school-exam-session";
import { schoolExamAiOn } from "@/lib/exam-flags";
import { alignFrqNumbers, closeSchoolAttempt, collectFinishedExam, continueGradeBatch, gradeBatchToken, gradeFinishedExamStep, gradeNextSchoolFrq, mcqSectionClosed, readSubmittedAt, saveManualFrqScores, teacherFrqViews, teacherMcqViews } from "@/lib/school-exam.server";

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
        const collected = await collectFinishedExam(assignment.id, { endsAt: assignment.ends_at, paperId: assignment.paper_id });
        if (collected.due) continueGradeBatch(request, assignment.id);
        const [{ data: roster }, { data: attempts }, { data: paper }, { data: frqs }, { data: questions }] = await Promise.all([
          db.from("school_roster").select("id,student_id,student_name,user_id").eq("class_id", assignment.class_id).order("student_id"),
          db
            .from("school_attempts")
            .select("id,roster_id,user_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers")
            .eq("assignment_id", assignmentId),
          db.from("mock_papers").select("id,slug,title,description").eq("id", assignment.paper_id).maybeSingle(),
          supabaseAdmin.from("paper_frqs").select("id,title,content,sort_order,max_score").eq("paper_id", assignment.paper_id).order("sort_order"),
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
        const numberedFrqs = await alignFrqNumbers(assignment.paper_id, frqs ?? []);
        const attemptMap = new Map((attempts ?? []).map((a) => [a.roster_id, a]));
        const names = await accountNames(db, (roster ?? []).map((row) => row.user_id));
        const rows = (roster ?? []).map((r) => {
          const a = attemptMap.get(r.id);
          const views = a ? teacherFrqViews(a.frq_answers, numberedFrqs, a.user_id ? byUser.get(a.user_id) ?? [] : []) : [];
          const mcqs = a ? teacherMcqViews(mcqPaper, a.mcq_detail) : [];
          const mcqClosed = !!a && (!!a.submitted_at || mcqSectionClosed(a.frq_answers));
          const scoredMcq = mcqs.filter((item) => item.is_correct != null);
          const scored = views.filter((v) => (v.manual_score ?? v.ai_score) != null);
          return {
            roster_id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            account_name: r.user_id ? names.get(r.user_id) ?? null : null,
            started_at: a?.started_at ?? null,
            submitted_at: a ? readSubmittedAt(a.frq_answers, a.submitted_at) : null,
            mcq_closed: mcqClosed,
            mcq_total: a?.submitted_at ? a.mcq_total : mcqClosed ? mcqs.length : null,
            mcq_correct: a?.submitted_at ? a.mcq_correct : mcqClosed && scoredMcq.length > 0 ? scoredMcq.filter((item) => item.is_correct).length : null,
            duration_seconds: a?.duration_seconds ?? null,
            frq_answers: Object.fromEntries(views.map((v) => [v.frq_id, { text: v.answer_text, fileUrl: v.file_url }])),
            mcqs,
            frqs: views,
            frq_score: scored.length ? views.reduce((sum, v) => sum + (v.manual_score ?? v.ai_score ?? 0), 0) : null,
            frq_max: views.reduce((sum, v) => sum + v.max_score, 0),
            status: a?.submitted_at ? "submitted" : a ? "in_progress" : "missing",
          };
        });
        return Response.json({
          assignment: { ...assignment, paper, ai_grade: schoolExamAiOn(paper?.description) },
          rows,
        });
      },

      POST: async ({ request }) => {
        const body = (await request.json()) as {
          assignment_id?: string;
          roster_id?: string;
          action?: string;
          manual?: Record<string, number | null>;
          comments?: Record<string, string | null>;
        };
        if (body.action === "batch" && body.assignment_id && request.headers.get("x-grade-token") === gradeBatchToken(body.assignment_id)) {
          const step = await gradeFinishedExamStep(body.assignment_id);
          const fatal = !!step.error && /额度|尚未配置|请求过多/.test(step.error);
          if (!step.waiting && !step.busy && !step.done && !fatal) continueGradeBatch(request, body.assignment_id);
          if (fatal && step.error) return jsonErr(step.error, 502);
          return Response.json({ ok: true, waiting: step.waiting, done: step.done, busy: step.busy, pending: step.pending, graded_sort: step.gradedSort, notice: step.notice ?? null });
        }
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const assignmentId = body.assignment_id ?? "";
        const rosterId = body.roster_id ?? "";
        if (!isUuid(assignmentId)) return jsonErr("missing fields");
        const owned = await teacherAssignment(u.userId, u.jwt, assignmentId);
        if (!owned) return jsonErr("not found", 404);
        if (body.action === "batch") {
          const step = await gradeFinishedExamStep(assignmentId);
          const fatal = !!step.error && /额度|尚未配置|请求过多/.test(step.error);
          if (!step.waiting && !step.busy && !step.done && !fatal) continueGradeBatch(request, assignmentId);
          if (fatal && step.error) return jsonErr(step.error, 502);
          return Response.json({ ok: true, waiting: step.waiting, done: step.done, busy: step.busy, pending: step.pending, graded_sort: step.gradedSort, notice: step.notice ?? null });
        }
        if (body.action !== "end" && !isUuid(rosterId)) return jsonErr("missing fields");
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
          continueGradeBatch(request, assignmentId);
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
          if (!attempt.submitted_at) await closeSchoolAttempt(attempt.id, owned.assignment.paper_id);
          if (Date.now() >= Date.parse(owned.assignment.ends_at)) continueGradeBatch(request, assignmentId);
          return Response.json({ ok: true });
        }
        if (!attempt.submitted_at) return jsonErr("学生还没交卷");
        if (body.action === "ai") {
          if (Date.now() < Date.parse(owned.assignment.ends_at)) return jsonErr("考试还没结束，截止后批改");
          const step = await gradeNextSchoolFrq(attempt.id, owned.assignment.paper_id, { force: true, retryFailed: true });
          if (step.error) return jsonErr(step.error, 502);
          return Response.json({ ok: true, done: step.done, pending: step.pending, busy: step.busy, graded_sort: step.gradedSort });
        }
        const next = await saveManualFrqScores(owned.assignment.paper_id, attempt.frq_answers, body.manual ?? {}, body.comments ?? {});
        const { error } = await supabaseAdmin.from("school_attempts").update({ frq_answers: next }).eq("id", attempt.id);
        if (error) return jsonErr(error.message, 500);
        return Response.json({ ok: true });
      },
    },
  },
});
