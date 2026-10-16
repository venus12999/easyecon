import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withExamAiGrade } from "@/lib/exam-flags";
import { jsonErr } from "@/lib/json-api";
import { teacherFrqViews } from "@/lib/school-exam.server";
import { ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { createFixedRandomSchoolPaper, makeExamCode } from "@/lib/school-random-paper.server";
import { isUuid } from "@/lib/school-exam-session";

export const Route = createFileRoute("/api/teacher/assignments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const url = new URL(request.url);
        if (url.searchParams.get("papers") === "1") {
          const [{ data: papers }, { data: imports }] = await Promise.all([
            db
              .from("mock_papers")
              .select("id,slug,title,year,total_seconds,description,created_at")
              .not("slug", "like", "frq-%")
              .order("sort_order")
              .order("year", { ascending: false }),
            db.from("school_pdf_imports").select("paper_id").eq("class_id", cls.id).not("paper_id", "is", null),
          ]);
          const ownSchool = new Set((imports ?? []).map((row) => row.paper_id).filter(Boolean));
          return Response.json({
            papers: (papers ?? []).filter(
              (p) =>
                !p.slug.startsWith("school-retired") &&
                (!p.slug.startsWith("school-") || ownSchool.has(p.id)),
            ),
          });
        }
        const { data } = await db
          .from("school_assignments")
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id,created_at")
          .eq("class_id", cls.id)
          .order("created_at", { ascending: false });
        const paperIds = [...new Set((data ?? []).map((a) => a.paper_id))];
        const { data: papers } = paperIds.length
          ? await db.from("mock_papers").select("id,slug,title").in("id", paperIds)
          : { data: [] as { id: string; slug: string; title: string }[] };
        const paperMap = new Map((papers ?? []).map((p) => [p.id, p]));
        return Response.json({
          assignments: (data ?? []).map((a) => ({
            ...a,
            paper: paperMap.get(a.paper_id) ?? null,
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
        const body = (await request.json()) as {
          title?: string;
          paper_id?: string;
          source?: "existing" | "random";
          starts_at?: string;
          ends_at?: string;
          publish_answers?: boolean;
          ai_grade?: boolean;
        };
        const title = (body.title ?? "").trim().slice(0, 120);
        if (!title) return jsonErr("请填写考试名称");
        const starts = Date.parse(body.starts_at ?? "");
        const ends = Date.parse(body.ends_at ?? "");
        if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
          return jsonErr("请设置有效的开考和截止时间");
        }
        let paperId = body.paper_id;
        if (body.source === "random") {
          const paper = await createFixedRandomSchoolPaper(`${title}（随机卷）`);
          paperId = paper.id;
        } else if (!paperId || !isUuid(paperId)) {
          return jsonErr("请选择一份试卷");
        } else {
          const { data: paper } = await db.from("mock_papers").select("id").eq("id", paperId).maybeSingle();
          if (!paper) return jsonErr("试卷不存在");
        }

        let examCode = makeExamCode();
        for (let i = 0; i < 8; i++) {
          const { data: clash } = await db
            .from("school_assignments")
            .select("id")
            .eq("exam_code", examCode)
            .maybeSingle();
          if (!clash) break;
          examCode = makeExamCode();
        }

        const { data, error } = await db
          .from("school_assignments")
          .insert({
            class_id: cls.id,
            paper_id: paperId!,
            title,
            exam_code: examCode,
            starts_at: new Date(starts).toISOString(),
            ends_at: new Date(ends).toISOString(),
            results_published: body.publish_answers === true,
            created_by: u.userId,
          })
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id")
          .single();
        if (error || !data) return jsonErr(error?.message ?? "创建失败", 500);
        let aiGradeSaved = body.ai_grade !== true;
        if (process.env.SUPABASE_SERVICE_ROLE_KEY && paperId) {
          const minutes = Math.max(10, Math.round((ends - starts) / 60000));
          const { data: paper } = await db.from("mock_papers").select("slug, description").eq("id", paperId).maybeSingle();
          if (paper?.slug?.startsWith("school-")) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const updated = await supabaseAdmin
              .from("mock_papers")
              .update({
                total_seconds: minutes * 60,
                frq_seconds: Math.max(15 * 60, minutes * 60 - 10 * 60),
                description: withExamAiGrade(paper.description, body.ai_grade === true),
              })
              .eq("id", paperId);
            aiGradeSaved = !updated.error;
          }
        }
        return Response.json({ assignment: data, ai_grade_saved: aiGradeSaved });
      },
      PATCH: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as { id?: string; results_published?: boolean };
        if (!body.id || !isUuid(body.id)) return jsonErr("missing id");
        if (body.results_published) {
          const { data: current } = await db
            .from("school_assignments")
            .select("id,ends_at,paper_id")
            .eq("id", body.id)
            .eq("class_id", cls.id)
            .maybeSingle();
          if (!current) return jsonErr("not found", 404);
          if (Date.now() < Date.parse(current.ends_at)) return jsonErr("考试还没结束，不能公布");
          const [{ data: attempts }, { data: frqs }] = await Promise.all([
            supabaseAdmin.from("school_attempts").select("submitted_at,user_id,frq_answers").eq("assignment_id", current.id),
            supabaseAdmin.from("paper_frqs").select("id,title,sort_order,max_score").eq("paper_id", current.paper_id),
          ]);
          if ((attempts ?? []).some((row) => !row.submitted_at)) return jsonErr("还有学生在作答，请先收卷");
          if ((frqs ?? []).length > 0) {
            const userIds = (attempts ?? []).map((row) => row.user_id).filter((id): id is string => !!id);
            const submissionQuery = userIds.length
              ? await supabaseAdmin
                  .from("frq_submissions")
                  .select("user_id,frq_id,ai_score,ai_max_score,ai_overall,ai_suggestions,ai_breakdown,created_at")
                  .eq("paper_id", current.paper_id)
                  .in("user_id", userIds)
                  .is("archived_at", null)
                  .order("created_at", { ascending: false })
              : null;
            const submissions = submissionQuery?.data ?? [];
            const byUser = new Map<string, NonNullable<typeof submissions>>();
            for (const row of submissions ?? []) {
              const list = byUser.get(row.user_id) ?? [];
              list.push(row);
              byUser.set(row.user_id, list);
            }
            const missing = (attempts ?? []).some((row) =>
              teacherFrqViews(row.frq_answers, frqs ?? [], row.user_id ? byUser.get(row.user_id) ?? [] : []).some((frq) => (frq.manual_score ?? frq.ai_score) == null),
            );
            if (missing) return jsonErr("大题还没有分数，不能公布");
          }
        }
        const { data, error } = await db
          .from("school_assignments")
          .update({ results_published: !!body.results_published })
          .eq("id", body.id)
          .eq("class_id", cls.id)
          .select("id,results_published")
          .maybeSingle();
        if (error) return jsonErr(error.message, 500);
        if (!data) return jsonErr("not found", 404);
        return Response.json({ assignment: data });
      },
    },
  },
});
