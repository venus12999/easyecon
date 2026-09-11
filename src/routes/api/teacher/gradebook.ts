import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonErr } from "@/lib/json-api";
import { ensureTeacherClass, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { isUuid } from "@/lib/school-exam-session";
import { parseFrqAnswers } from "@/lib/school-exam.server";

export const Route = createFileRoute("/api/teacher/gradebook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const cls = await ensureTeacherClass(u.userId);
        const assignmentId = new URL(request.url).searchParams.get("assignment_id") ?? "";
        if (!isUuid(assignmentId)) return jsonErr("missing assignment_id");
        const { data: assignment } = await supabaseAdmin
          .from("school_assignments")
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id")
          .eq("id", assignmentId)
          .eq("class_id", cls.id)
          .maybeSingle();
        if (!assignment) return jsonErr("not found", 404);
        const [{ data: roster }, { data: attempts }, { data: paper }] = await Promise.all([
          supabaseAdmin
            .from("school_roster")
            .select("id,student_id,student_name")
            .eq("class_id", cls.id)
            .order("student_id"),
          supabaseAdmin
            .from("school_attempts")
            .select("id,roster_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,frq_answers")
            .eq("assignment_id", assignmentId),
          supabaseAdmin.from("mock_papers").select("id,slug,title").eq("id", assignment.paper_id).maybeSingle(),
        ]);
        const attemptMap = new Map((attempts ?? []).map((a) => [a.roster_id, a]));
        const rows = (roster ?? []).map((r) => {
          const a = attemptMap.get(r.id);
          const frq = a ? parseFrqAnswers(a.frq_answers) : { items: {}, progress: null };
          return {
            roster_id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            started_at: a?.started_at ?? null,
            submitted_at: a?.submitted_at ?? null,
            mcq_total: a?.submitted_at ? a.mcq_total : null,
            mcq_correct: a?.submitted_at ? a.mcq_correct : null,
            duration_seconds: a?.duration_seconds ?? null,
            frq_answers: a?.submitted_at ? frq.items : {},
            status: a?.submitted_at ? "submitted" : a ? "in_progress" : "missing",
          };
        });
        return Response.json({ assignment: { ...assignment, paper }, rows });
      },
    },
  },
});
