import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { apMicroScore, scoreMaxError, summarizeApScores, type ApClassSummary } from "@/lib/ap-score";
import { sectionMinutesError, sectionTotalMinutes } from "@/lib/exam-sections";
import { withExamAiGrade } from "@/lib/exam-flags";
import { jsonErr } from "@/lib/json-api";
import { isBlankStudentAnswer } from "@/lib/frq-answer";
import { collectFinishedExam, continueGradeBatch, parseFrqAnswers, readStoredGrades, teacherFrqViews } from "@/lib/school-exam.server";
import { ensureTeacherClass, getTeacherDb, isSchoolAdmin, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { createFixedRandomSchoolPaper, makeExamCode } from "@/lib/school-random-paper.server";
import { isUuid } from "@/lib/school-exam-session";

type AttemptScoreRow = {
  assignment_id: string;
  submitted_at: string | null;
  mcq_correct: number | null;
  mcq_total: number | null;
  frq_answers?: unknown;
};

function frqWasAnswered(raw: unknown, id: string) {
  const item = parseFrqAnswers(raw).items[id];
  if (!item || typeof item !== "object") return false;
  const text = typeof item.text === "string" ? item.text : "";
  return !isBlankStudentAnswer(text, typeof item.fileUrl === "string" ? item.fileUrl : null);
}

function apForAssignment(rows: AttemptScoreRow[], frqIds: string[], frqMax: number, scoreMax: number | null): { ap: ApClassSummary; pending_frq: number } {
  let pendingFrq = 0;
  const results = rows
    .filter((row) => row.submitted_at)
    .map((row) => {
      const grades = readStoredGrades(row.frq_answers);
      let earned = 0;
      let open = false;
      if (frqMax > 0) {
        for (const id of frqIds) {
          const score = grades[id]?.manual_score ?? grades[id]?.ai_score;
          if (typeof score === "number") {
            earned += score;
            continue;
          }
          if (frqWasAnswered(row.frq_answers, id)) {
            open = true;
            pendingFrq += 1;
          }
        }
      }
      return apMicroScore({
        mcqCorrect: row.mcq_correct,
        mcqTotal: row.mcq_total,
        frqEarned: frqMax > 0 && !open ? earned : null,
        frqMax: frqMax > 0 ? frqMax : null,
      });
    });
  return { ap: summarizeApScores(results, scoreMax), pending_frq: pendingFrq };
}

async function frqScales(db: { from: typeof supabaseAdmin.from }, paperIds: string[]) {
  const ids = new Map<string, string[]>();
  const max = new Map<string, number>();
  if (!paperIds.length) return { ids, max };
  const { data } = await db.from("paper_frqs").select("id,paper_id,max_score").in("paper_id", paperIds);
  for (const frq of data ?? []) {
    const list = ids.get(frq.paper_id) ?? [];
    list.push(frq.id);
    ids.set(frq.paper_id, list);
    max.set(frq.paper_id, (max.get(frq.paper_id) ?? 0) + (frq.max_score ?? 0));
  }
  return { ids, max };
}

async function listAllExamScores(request: Request) {
  const db = supabaseAdmin;
  const { data, error } = await db
    .from("school_assignments")
    .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id,class_id,created_at,mcq_seconds,frq_seconds,break_seconds,score_max")
    .order("created_at", { ascending: false });
  if (error) return jsonErr(error.message, 500);
  const exams = data ?? [];
  const now = Date.now();
  for (const exam of exams) {
    if (exam.results_published || now < Date.parse(exam.ends_at)) continue;
    await collectFinishedExam(exam.id, { endsAt: exam.ends_at, paperId: exam.paper_id });
    continueGradeBatch(request, exam.id);
  }
  const classIds = [...new Set(exams.map((exam) => exam.class_id))];
  const paperIds = [...new Set(exams.map((exam) => exam.paper_id))];
  const assignmentIds = exams.map((exam) => exam.id);
  const [{ data: classes }, { data: papers }, { data: roster }, { data: attempts }] = await Promise.all([
    classIds.length
      ? db.from("school_classes").select("id,name,teacher_user_id").in("id", classIds)
      : Promise.resolve({ data: [] as { id: string; name: string; teacher_user_id: string }[] }),
    paperIds.length
      ? db.from("mock_papers").select("id,slug,title").in("id", paperIds)
      : Promise.resolve({ data: [] as { id: string; slug: string; title: string }[] }),
    classIds.length
      ? db.from("school_roster").select("class_id").in("class_id", classIds)
      : Promise.resolve({ data: [] as { class_id: string }[] }),
    assignmentIds.length
      ? db.from("school_attempts").select("assignment_id,submitted_at,mcq_correct,mcq_total,frq_answers").in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as AttemptScoreRow[] }),
  ]);
  const frqScale = await frqScales(db, paperIds);
  const teacherIds = [...new Set((classes ?? []).map((row) => row.teacher_user_id))];
  const { data: profiles } = teacherIds.length
    ? await db.from("profiles").select("user_id,display_name").in("user_id", teacherIds)
    : { data: [] as { user_id: string; display_name: string | null }[] };
  const teacherName = new Map((profiles ?? []).map((row) => [row.user_id, row.display_name?.trim() || ""]));
  const classMap = new Map((classes ?? []).map((row) => [row.id, row]));
  const paperMap = new Map((papers ?? []).map((row) => [row.id, row]));
  const rosterCount = new Map<string, number>();
  for (const row of roster ?? []) rosterCount.set(row.class_id, (rosterCount.get(row.class_id) ?? 0) + 1);
  const stats = new Map<string, { submitted_count: number; mcq_correct: number; mcq_total: number }>();
  for (const row of attempts ?? []) {
    const cur = stats.get(row.assignment_id) ?? { submitted_count: 0, mcq_correct: 0, mcq_total: 0 };
    if (row.submitted_at) {
      cur.submitted_count += 1;
      if (typeof row.mcq_correct === "number" && typeof row.mcq_total === "number" && row.mcq_total > 0) {
        cur.mcq_correct += row.mcq_correct;
        cur.mcq_total += row.mcq_total;
      }
    }
    stats.set(row.assignment_id, cur);
  }
  return Response.json({
    admin: true,
    assignments: exams.map((exam) => {
      const cls = classMap.get(exam.class_id);
      const stat = stats.get(exam.id);
      return {
        ...exam,
        paper: paperMap.get(exam.paper_id) ?? null,
        class_name: cls?.name ?? "班级",
        teacher_name: cls ? teacherName.get(cls.teacher_user_id) || "教师" : "教师",
        roster_count: rosterCount.get(exam.class_id) ?? 0,
        submitted_count: stat?.submitted_count ?? 0,
        mcq_correct: stat?.mcq_correct ?? 0,
        mcq_total: stat?.mcq_total ?? 0,
        ...apForAssignment(
          (attempts ?? []).filter((row) => row.assignment_id === exam.id),
          frqScale.ids.get(exam.paper_id) ?? [],
          frqScale.max.get(exam.paper_id) ?? 0,
          exam.score_max,
        ),
      };
    }),
  });
}

export const Route = createFileRoute("/api/teacher/assignments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const url = new URL(request.url);
        if (url.searchParams.get("papers") !== "1" && (await isSchoolAdmin(u.userId, u.email))) {
          return listAllExamScores(request);
        }
        const cls = await ensureTeacherClass(u.userId, db);
        if (url.searchParams.get("papers") === "1") {
          const [{ data: papers }, { data: imports }] = await Promise.all([
            db
              .from("mock_papers")
              .select("id,slug,title,year,total_seconds,frq_seconds,break_seconds,description,created_at")
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
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id,created_at,mcq_seconds,frq_seconds,break_seconds,score_max")
          .eq("class_id", cls.id)
          .order("created_at", { ascending: false });
        const now = Date.now();
        for (const exam of data ?? []) {
          if (exam.results_published || now < Date.parse(exam.ends_at)) continue;
          await collectFinishedExam(exam.id, { endsAt: exam.ends_at, paperId: exam.paper_id });
          continueGradeBatch(request, exam.id);
        }
        const paperIds = [...new Set((data ?? []).map((a) => a.paper_id))];
        const assignmentIds = (data ?? []).map((a) => a.id);
        const [{ data: papers }, rosterCount, { data: attempts }] = await Promise.all([
          paperIds.length
            ? db.from("mock_papers").select("id,slug,title").in("id", paperIds)
            : Promise.resolve({ data: [] as { id: string; slug: string; title: string }[] }),
          db.from("school_roster").select("id", { count: "exact", head: true }).eq("class_id", cls.id),
          assignmentIds.length
            ? db.from("school_attempts").select("assignment_id,submitted_at,mcq_correct,mcq_total,frq_answers").in("assignment_id", assignmentIds)
            : Promise.resolve({ data: [] as AttemptScoreRow[] }),
        ]);
        const frqScale = await frqScales(db, paperIds);
        const paperMap = new Map((papers ?? []).map((p) => [p.id, p]));
        const stats = new Map<string, { submitted_count: number; mcq_correct: number; mcq_total: number }>();
        for (const row of attempts ?? []) {
          const cur = stats.get(row.assignment_id) ?? { submitted_count: 0, mcq_correct: 0, mcq_total: 0 };
          if (row.submitted_at) {
            cur.submitted_count += 1;
            if (typeof row.mcq_correct === "number" && typeof row.mcq_total === "number" && row.mcq_total > 0) {
              cur.mcq_correct += row.mcq_correct;
              cur.mcq_total += row.mcq_total;
            }
          }
          stats.set(row.assignment_id, cur);
        }
        return Response.json({
          assignments: (data ?? []).map((a) => {
            const stat = stats.get(a.id);
            return {
              ...a,
              paper: paperMap.get(a.paper_id) ?? null,
              roster_count: rosterCount.count ?? 0,
              submitted_count: stat?.submitted_count ?? 0,
              mcq_correct: stat?.mcq_correct ?? 0,
              mcq_total: stat?.mcq_total ?? 0,
              ...apForAssignment(
                (attempts ?? []).filter((row) => row.assignment_id === a.id),
                frqScale.ids.get(a.paper_id) ?? [],
                frqScale.max.get(a.paper_id) ?? 0,
                a.score_max,
              ),
            };
          }),
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
          mcq_minutes?: number;
          frq_minutes?: number;
          break_minutes?: number;
          score_max?: number;
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
        const mcqMinutes = Math.round(Number(body.mcq_minutes));
        const frqMinutes = Math.round(Number(body.frq_minutes));
        const breakMinutes = frqMinutes > 0 ? Math.round(Number(body.break_minutes)) : 0;
        const sectionError = sectionMinutesError(mcqMinutes, frqMinutes, breakMinutes);
        if (sectionError) return jsonErr(sectionError);
        const scoreMax = Math.round(Number(body.score_max));
        const maxError = scoreMaxError(scoreMax);
        if (maxError) return jsonErr(maxError);
        const sectionMs = sectionTotalMinutes(mcqMinutes, frqMinutes, breakMinutes) * 60 * 1000;
        if (ends - starts + 90_000 < sectionMs) return jsonErr("截止时间要盖住选择题、休息和大题");
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
            mcq_seconds: mcqMinutes * 60,
            frq_seconds: frqMinutes * 60,
            break_seconds: breakMinutes * 60,
            score_max: scoreMax,
            results_published: body.publish_answers === true,
            created_by: u.userId,
          })
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id")
          .single();
        if (error || !data) return jsonErr(error?.message ?? "创建失败", 500);
        let aiGradeSaved = body.ai_grade !== true;
        if (process.env.SUPABASE_SERVICE_ROLE_KEY && paperId) {
          const { data: paper } = await db.from("mock_papers").select("slug, description").eq("id", paperId).maybeSingle();
          if (paper?.slug?.startsWith("school-")) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const updated = await supabaseAdmin
              .from("mock_papers")
              .update({
                total_seconds: mcqMinutes * 60,
                frq_seconds: frqMinutes * 60,
                break_seconds: breakMinutes * 60,
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
          await collectFinishedExam(current.id, { endsAt: current.ends_at, paperId: current.paper_id });
          const [{ data: attempts }, { data: frqs }] = await Promise.all([
            supabaseAdmin.from("school_attempts").select("submitted_at,user_id,frq_answers").eq("assignment_id", current.id),
            supabaseAdmin.from("paper_frqs").select("id,title,sort_order,max_score").eq("paper_id", current.paper_id),
          ]);
          if ((attempts ?? []).some((row) => !row.submitted_at)) return jsonErr("还有已开考的答卷没能收上来，请稍后再公布");
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
            const anyScored = (attempts ?? []).some((row) =>
              teacherFrqViews(row.frq_answers, frqs ?? [], row.user_id ? byUser.get(row.user_id) ?? [] : []).some((frq) => (frq.manual_score ?? frq.ai_score) != null),
            );
            if (missing) return jsonErr(anyScored ? "还有大题没批完。已经出分的会保留，批完再公布" : "大题还没有分数，不能公布");
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
