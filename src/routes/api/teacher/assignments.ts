import { createFileRoute } from "@tanstack/react-router";
import { jsonErr } from "@/lib/json-api";
import { ensureTeacherClass, getTeacherDb, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { createFixedRandomSchoolPaper, makeExamCode } from "@/lib/school-random-paper.server";
import { isUuid } from "@/lib/school-exam-session";

export const Route = createFileRoute("/api/teacher/assignments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
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
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as {
          title?: string;
          paper_id?: string;
          source?: "existing" | "random";
          starts_at?: string;
          ends_at?: string;
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
            created_by: u.userId,
          })
          .select("id,title,exam_code,starts_at,ends_at,results_published,paper_id")
          .single();
        if (error || !data) return jsonErr(error?.message ?? "创建失败", 500);
        return Response.json({ assignment: data });
      },
      PATCH: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const body = (await request.json()) as { id?: string; results_published?: boolean };
        if (!body.id || !isUuid(body.id)) return jsonErr("missing id");
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
