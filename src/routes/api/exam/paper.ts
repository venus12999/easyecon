import { createFileRoute } from "@tanstack/react-router";
import { jsonErr } from "@/lib/json-api";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { isUuid } from "@/lib/school-exam-session";
import {
  finalizeIfOverdue,
  inExamWindow,
  loadAssignmentBundle,
  loadAttempt,
  loadSchoolPaperQuestions,
  publicAttempt,
  rosterForUser,
} from "@/lib/school-exam.server";

export const Route = createFileRoute("/api/exam/paper")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const assignmentId = new URL(request.url).searchParams.get("assignment_id") ?? "";
        if (!isUuid(assignmentId)) return jsonErr("missing assignment_id");
        const bundle = await loadAssignmentBundle(assignmentId);
        if (!bundle) return jsonErr("考试不存在", 404);
        const roster = await rosterForUser(u.userId, bundle.assignment.class_id);
        if (!roster) return jsonErr("你不在本场花名册中", 403);
        let attempt = await loadAttempt(bundle.assignment.id, roster.id);
        if (attempt) {
          attempt = await finalizeIfOverdue(attempt, bundle.paper.id, bundle.assignment.ends_at);
        }
        const published = bundle.assignment.results_published;
        const { questions, frqs } = await loadSchoolPaperQuestions(bundle.paper.id, published);
        return Response.json({
          assignment: bundle.assignment,
          paper: bundle.paper,
          roster: { student_id: roster.student_id, student_name: roster.student_name },
          attempt: attempt ? publicAttempt(attempt, published) : null,
          window_open: inExamWindow(bundle.assignment.starts_at, bundle.assignment.ends_at),
          questions,
          frqs,
        });
      },
    },
  },
});
