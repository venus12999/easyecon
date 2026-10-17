import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonErr } from "@/lib/json-api";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { isUuid } from "@/lib/school-exam-session";
import {
  closeSchoolAttempt,
  continueGradeBatch,
  finalizeIfOverdue,
  gradeFinishedExamStep,
  inExamWindow,
  loadAssignmentBundle,
  loadAttempt,
  mergeSavedAttempt,
  publicAttempt,
  rosterForUser,
  type McqPick,
} from "@/lib/school-exam.server";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/exam/attempt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const assignmentId = new URL(request.url).searchParams.get("assignment_id") ?? "";
        const bundle = await loadAssignmentBundle(assignmentId);
        if (!bundle) return jsonErr("考试不存在", 404);
        const roster = await rosterForUser(u.userId, bundle.assignment.class_id);
        if (!roster) return jsonErr("你不在本场花名册中", 403);
        let attempt = await loadAttempt(bundle.assignment.id, roster.id);
        const wasSubmitted = !!attempt?.submitted_at;
        if (attempt) {
          attempt = await finalizeIfOverdue(attempt, bundle.paper.id, bundle.assignment.ends_at);
        }
        if (!wasSubmitted && attempt?.submitted_at && Date.now() >= Date.parse(bundle.assignment.ends_at)) {
          continueGradeBatch(request, bundle.assignment.id);
        }
        return Response.json({
          assignment: bundle.assignment,
          paper: bundle.paper,
          roster: { student_id: roster.student_id, student_name: roster.student_name },
          attempt: attempt ? publicAttempt(attempt, bundle.assignment.results_published) : null,
          window_open: inExamWindow(bundle.assignment.starts_at, bundle.assignment.ends_at),
        });
      },
      POST: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const body = (await request.json()) as {
          assignment_id?: string;
          action?: "start" | "save" | "submit" | "grade";
          mcq_detail?: McqPick[];
          frq_answers?: unknown;
          duration_seconds?: number;
        };
        if (!body.assignment_id || !isUuid(body.assignment_id)) return jsonErr("missing assignment_id");
        const action = body.action ?? "start";
        const bundle = await loadAssignmentBundle(body.assignment_id);
        if (!bundle) return jsonErr("考试不存在", 404);
        const roster = await rosterForUser(u.userId, bundle.assignment.class_id);
        if (!roster) return jsonErr("你不在本场花名册中", 403);

        let attempt = await loadAttempt(bundle.assignment.id, roster.id);
        const wasSubmitted = !!attempt?.submitted_at;
        if (attempt) {
          attempt = await finalizeIfOverdue(attempt, bundle.paper.id, bundle.assignment.ends_at);
        }
        if (!wasSubmitted && attempt?.submitted_at && Date.now() >= Date.parse(bundle.assignment.ends_at)) {
          continueGradeBatch(request, bundle.assignment.id);
        }
        const windowOpen = inExamWindow(bundle.assignment.starts_at, bundle.assignment.ends_at);
        const overdue = Date.now() > Date.parse(bundle.assignment.ends_at);

        if (action === "start") {
          if (attempt?.submitted_at) {
            return Response.json({
              assignment: bundle.assignment,
              paper: bundle.paper,
              attempt: publicAttempt(attempt, bundle.assignment.results_published),
            });
          }
          if (!attempt && !windowOpen) {
            if (Date.now() < Date.parse(bundle.assignment.starts_at)) return jsonErr("考试尚未开始");
            return jsonErr("考试已截止，无法开考");
          }
          if (!attempt) {
            const { data, error } = await supabaseAdmin
              .from("school_attempts")
              .insert({
                assignment_id: bundle.assignment.id,
                roster_id: roster.id,
                user_id: u.userId,
              })
              .select("id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers")
              .single();
            if (error || !data) return jsonErr(error?.message ?? "无法开始考试", 500);
            attempt = { ...data, assignment_id: bundle.assignment.id, roster_id: roster.id, user_id: u.userId };
          }
          return Response.json({
            assignment: bundle.assignment,
            paper: bundle.paper,
            attempt: publicAttempt(attempt, bundle.assignment.results_published),
          });
        }

        if (action === "grade") {
          const step = await gradeFinishedExamStep(bundle.assignment.id);
          const fatal = !!step.error && /额度|尚未配置|请求过多/.test(step.error);
          if (!step.waiting && !step.busy && !step.done && !fatal) continueGradeBatch(request, bundle.assignment.id);
          if (fatal && step.error) return jsonErr(step.error, 502);
          return Response.json({ ok: true, waiting: step.waiting, done: step.done, pending: step.pending, busy: step.busy, graded_sort: step.gradedSort });
        }

        if (!attempt) return jsonErr("尚未开考");
        if (attempt.submitted_at) return jsonErr("已交卷，不能再改");

        if (action === "save") {
          if (overdue) return jsonErr("考试已截止，请交卷");
          const merged = mergeSavedAttempt(attempt, {
            mcq_detail: body.mcq_detail,
            frq_answers: body.frq_answers,
          });
          const { error } = await supabaseAdmin
            .from("school_attempts")
            .update({
              mcq_detail: merged.mcq_detail as Json,
              frq_answers: merged.frq_answers as Json,
              duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : attempt.duration_seconds,
            })
            .eq("id", attempt.id)
            .is("submitted_at", null);
          if (error) return jsonErr(error.message, 500);
          return Response.json({ ok: true });
        }

        if (action === "submit") {
          const merged = mergeSavedAttempt(attempt, {
            mcq_detail: body.mcq_detail,
            frq_answers: body.frq_answers,
          }, { submit: true });
          const closed = await closeSchoolAttempt(attempt.id, bundle.paper.id, {
            mcq_detail: merged.mcq_detail,
            frq_answers: merged.frq_answers,
            duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : attempt.duration_seconds,
          });
          if (!closed?.submitted_at) return jsonErr("交卷失败", 500);
          if (Date.now() >= Date.parse(bundle.assignment.ends_at)) continueGradeBatch(request, bundle.assignment.id);
          return Response.json({
            assignment: bundle.assignment,
            paper: bundle.paper,
            attempt: publicAttempt(closed, bundle.assignment.results_published),
          });
        }

        return jsonErr("unknown action");
      },
    },
  },
});
