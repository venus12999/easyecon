import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonErr } from "@/lib/json-api";
import { normalizeStudentName } from "@/lib/school-exam-session";
import { examAccountPassword, examEmail, inExamWindow, issueExamSession, loadAttempt } from "@/lib/school-exam.server";

export const Route = createFileRoute("/api/exam/enter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          exam_code?: string;
          student_id?: string;
          student_name?: string;
        };
        const examCode = (body.exam_code ?? "").trim().toUpperCase();
        const studentId = (body.student_id ?? "").trim();
        const studentName = (body.student_name ?? "").trim();
        if (!examCode || !studentId || !studentName) return jsonErr("请填写学号、姓名和考试码");

        const { data: assignment } = await supabaseAdmin
          .from("school_assignments")
          .select("id,class_id,paper_id,title,exam_code,starts_at,ends_at,results_published")
          .eq("exam_code", examCode)
          .maybeSingle();
        if (!assignment) return jsonErr("考试码无效");

        const { data: roster } = await supabaseAdmin
          .from("school_roster")
          .select("id,student_id,student_name,name_key,user_id,class_id")
          .eq("class_id", assignment.class_id)
          .eq("student_id", studentId)
          .maybeSingle();
        if (!roster) return jsonErr("学号不在本场花名册中");
        if (roster.name_key !== normalizeStudentName(studentName)) {
          return jsonErr("姓名与花名册不一致");
        }

        const attempt = await loadAttempt(assignment.id, roster.id);
        const now = Date.now();
        const windowOpen = inExamWindow(assignment.starts_at, assignment.ends_at, now);
        if (!attempt && !windowOpen) {
          if (now < Date.parse(assignment.starts_at)) return jsonErr("考试尚未开始");
          return jsonErr("考试已截止");
        }

        const email = roster.user_id
          ? ((await supabaseAdmin.auth.admin.getUserById(roster.user_id)).data.user?.email ?? examEmail(studentId, assignment.class_id))
          : examEmail(studentId, assignment.class_id);
        const password = examAccountPassword(studentId, assignment.class_id);

        let session;
        try {
          session = await issueExamSession(email, password, roster.user_id, {
            school_exam: true,
            student_id: studentId,
            student_name: studentName,
          });
        } catch (err) {
          return jsonErr(err instanceof Error ? err.message : "无法进入考场", 500);
        }

        if (roster.user_id && roster.user_id !== session.user.id) {
          return jsonErr("该学号已绑定其他账号");
        }
        if (!roster.user_id) {
          const { error } = await supabaseAdmin
            .from("school_roster")
            .update({ user_id: session.user.id })
            .eq("id", roster.id)
            .is("user_id", null);
          if (error) return jsonErr(error.message, 500);
        }

        const { data: paper } = await supabaseAdmin
          .from("mock_papers")
          .select("id,slug,title")
          .eq("id", assignment.paper_id)
          .maybeSingle();
        if (!paper) return jsonErr("试卷不存在", 500);

        return Response.json({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          assignment: {
            id: assignment.id,
            title: assignment.title,
            starts_at: assignment.starts_at,
            ends_at: assignment.ends_at,
            results_published: assignment.results_published,
          },
          paper,
          attempt: attempt
            ? {
                submitted: !!attempt.submitted_at,
                started_at: attempt.started_at,
              }
            : null,
        });
      },
    },
  },
});
