import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";
import { getTeacherDb } from "@/lib/teacher-auth.server";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { jsonErr } from "@/lib/json-api";
import { examSlugFromFilename } from "@/lib/ap-exam-parse";
import { isUuid } from "@/lib/school-exam-session";
import type { SupabaseClient } from "@supabase/supabase-js";

function unauth() {
  return jsonErr("unauthorized", 401);
}

const PROMOTE_MARK = "【申请列入模拟考试真题库】";

async function adminDb(request: Request): Promise<SupabaseClient> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return supabaseAdmin as unknown as SupabaseClient;
  const u = await verifyUserRequest(request);
  if (!u) throw new Error("unauthorized");
  return getTeacherDb(u.jwt);
}

async function dropPaperItems(db: SupabaseClient, paperId: string) {
  const { data: frqRows, error: frqListErr } = await db.from("paper_frqs").select("id").eq("paper_id", paperId);
  if (frqListErr) return frqListErr.message;
  const frqIds = (frqRows ?? []).map((row) => row.id);
  if (frqIds.length > 0) {
    const rubricErr = await db.from("paper_frq_rubrics").delete().in("frq_id", frqIds);
    if (rubricErr.error) return rubricErr.error.message;
    const draftErr = await db.from("frq_drafts").delete().eq("paper_id", paperId);
    if (draftErr.error) return draftErr.error.message;
    const subErr = await db.from("frq_submissions").delete().in("frq_id", frqIds);
    if (subErr.error) return subErr.error.message;
    const frqErr = await db.from("paper_frqs").delete().eq("paper_id", paperId);
    if (frqErr.error) return frqErr.error.message;
  }
  const { data: oldQs, error: linkErr } = await db.from("paper_questions").select("question_id").eq("paper_id", paperId);
  if (linkErr) return linkErr.message;
  const unlink = await db.from("paper_questions").delete().eq("paper_id", paperId);
  if (unlink.error) return unlink.error.message;
  const ids = (oldQs ?? []).map((row) => row.question_id);
  if (ids.length === 0) return null;
  const { data: still, error: stillErr } = await db.from("paper_questions").select("question_id").in("question_id", ids);
  if (stillErr) return stillErr.message;
  const shared = new Set((still ?? []).map((row) => row.question_id));
  const owned = ids.filter((id) => !shared.has(id));
  if (owned.length === 0) return null;
  const { error } = await db.from("questions").delete().in("id", owned);
  return error?.message ?? null;
}

async function retirePaper(db: SupabaseClient, paperId: string) {
  const dropped = await dropPaperItems(db, paperId);
  if (dropped) return { message: dropped };
  const retired = `school-retired-${crypto.randomUUID().slice(0, 8)}`;
  const { error } = await db
    .from("mock_papers")
    .update({
      slug: retired,
      sort_order: 999,
      description: "已被新卷替换，已从模拟考试真题库下架。",
    })
    .eq("id", paperId);
  return error;
}

type ExamRow = { title: string; ends_at: string };

async function paperExams(db: SupabaseClient, paperId: string) {
  const { data, error } = await db.from("school_assignments").select("title,ends_at").eq("paper_id", paperId);
  if (error) return { error: error.message, open: [] as ExamRow[], count: 0 };
  const exams = (data ?? []) as ExamRow[];
  const now = Date.now();
  return {
    error: null as string | null,
    open: exams.filter((exam) => Date.parse(exam.ends_at) > now),
    count: exams.length,
  };
}

function openExamMessage(open: ExamRow[], verb: string) {
  const title = open[0]?.title || "这场考试";
  return `「${title}」还没结束，结束后才能${verb}`;
}

async function practiceIncluded(db: SupabaseClient, paperId: string) {
  const { data: links } = await db.from("paper_questions").select("question_id").eq("paper_id", paperId);
  const ids = (links ?? []).map((row) => row.question_id);
  const { count: frqTotal } = await db.from("paper_frqs").select("id", { count: "exact", head: true }).eq("paper_id", paperId);
  const { count: frqIn } = await db.from("paper_frqs").select("id", { count: "exact", head: true }).eq("paper_id", paperId).eq("exclude_from_pool", false);
  let qIn = 0;
  if (ids.length > 0) {
    const { count } = await db.from("questions").select("id", { count: "exact", head: true }).in("id", ids).eq("exclude_from_pool", false);
    qIn = count ?? 0;
  }
  const total = ids.length + (frqTotal ?? 0);
  return total > 0 && qIn + (frqIn ?? 0) === total;
}

async function includeInPractice(db: SupabaseClient, paperId: string) {
  const { data: links, error: linkErr } = await db.from("paper_questions").select("question_id").eq("paper_id", paperId);
  if (linkErr) return linkErr.message;
  const ids = (links ?? []).map((row) => row.question_id);
  const { count: frqTotal, error: frqCountErr } = await db
    .from("paper_frqs")
    .select("id", { count: "exact", head: true })
    .eq("paper_id", paperId);
  if (frqCountErr) return frqCountErr.message;
  if (ids.length === 0 && (frqTotal ?? 0) === 0) return "这份卷没有题目";
  if (ids.length > 0) {
    const { data: questions, error: qErr } = await db.from("questions").select("id,correct_answer").in("id", ids);
    if (qErr) return qErr.message;
    const missing = (questions ?? []).filter((q) => !/^[A-E]$/i.test(q.correct_answer ?? "")).length;
    if (missing > 0) return `还有 ${missing} 道选择题没填答案，填好后再纳入刷题库`;
    const { error } = await db.from("questions").update({ exclude_from_pool: false }).in("id", ids);
    if (error) return error.message;
  }
  if ((frqTotal ?? 0) > 0) {
    const { error } = await db.from("paper_frqs").update({ exclude_from_pool: false }).eq("paper_id", paperId);
    if (error) return error.message;
  }
  return null;
}

/** Finished exams still need the question rows. Take the paper out of future use and the practice pool. */
async function shelveEndedPaper(db: SupabaseClient, paperId: string) {
  const { data: links, error: linkErr } = await db.from("paper_questions").select("question_id").eq("paper_id", paperId);
  if (linkErr) return linkErr.message;
  const ids = (links ?? []).map((row) => row.question_id);
  if (ids.length > 0) {
    const { data: others, error: otherErr } = await db
      .from("paper_questions")
      .select("question_id")
      .in("question_id", ids)
      .neq("paper_id", paperId);
    if (otherErr) return otherErr.message;
    const shared = new Set((others ?? []).map((row) => row.question_id));
    const owned = ids.filter((id) => !shared.has(id));
    if (owned.length > 0) {
      const { error } = await db.from("questions").update({ exclude_from_pool: true }).in("id", owned);
      if (error) return error.message;
    }
  }
  const { error: frqErr } = await db.from("paper_frqs").update({ exclude_from_pool: true }).eq("paper_id", paperId);
  if (frqErr) return frqErr.message;
  const retired = `school-retired-${crypto.randomUUID().slice(0, 8)}`;
  const { error } = await db.from("mock_papers").update({
    slug: retired,
    sort_order: 999,
    description: "管理员已删除这份教师题库。已结束考试的成绩仍保留，题目不再进入刷题。",
  }).eq("id", paperId);
  return error?.message ?? null;
}

async function deleteImportsForPaper(db: SupabaseClient, paperId: string) {
  const { data: imports, error } = await db.from("school_pdf_imports").select("id").eq("paper_id", paperId);
  if (error) return error.message;
  const ids = (imports ?? []).map((row) => row.id);
  if (ids.length === 0) return null;
  const items = await db.from("school_pdf_items").delete().in("import_id", ids);
  if (items.error) return items.error.message;
  const pages = await db.from("school_pdf_pages").delete().in("import_id", ids);
  if (pages.error) return pages.error.message;
  const removed = await db.from("school_pdf_imports").delete().in("id", ids);
  return removed.error?.message ?? null;
}

async function destroyUnusedPaper(db: SupabaseClient, paperId: string) {
  const dropped = await dropPaperItems(db, paperId);
  if (dropped) return dropped;
  const imports = await deleteImportsForPaper(db, paperId);
  if (imports) return imports;
  const { error: paperErr } = await db.from("mock_papers").delete().eq("id", paperId);
  return paperErr?.message ?? null;
}

/** School exam papers stay out of the question bank until an admin promotes them. */
async function removeUnapprovedPaper(db: SupabaseClient, paperId: string) {
  const { data: paper } = await db.from("mock_papers").select("id,slug").eq("id", paperId).maybeSingle();
  if (!paper) return { error: "试卷不存在", status: 404 as const };
  if (!paper.slug.startsWith("school-") || paper.slug.startsWith("school-retired")) {
    return { error: "已经列入题库的卷不能从这里删除", status: 400 as const };
  }
  const exams = await paperExams(db, paper.id);
  if (exams.error) return { error: exams.error, status: 500 as const };
  if (exams.open.length) return { error: openExamMessage(exams.open, "删除"), status: 400 as const };
  if (exams.count > 0) {
    const shelved = await shelveEndedPaper(db, paper.id);
    if (shelved) return { error: shelved, status: 500 as const };
    return { kept_scores: true as const };
  }
  const removed = await destroyUnusedPaper(db, paper.id);
  if (removed) return { error: removed, status: 500 as const };
  return { kept_scores: false as const };
}

export const Route = createFileRoute("/api/admin/teacher-uploads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const db = await adminDb(request);
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (id && isUuid(id)) {
          const { data: imp } = await db.from("school_pdf_imports").select("*").eq("id", id).maybeSingle();
          if (!imp) return jsonErr("not found", 404);
          const [{ data: pages }, { data: items }, { data: paper }] = await Promise.all([
            db.from("school_pdf_pages").select("id,page_number,image_url,extracted_text").eq("import_id", id).order("page_number"),
            db.from("school_pdf_items").select("*").eq("import_id", id).order("sort_order"),
            imp.paper_id
              ? db.from("mock_papers").select("id,slug,title,year,description,sort_order").eq("id", imp.paper_id).maybeSingle()
              : Promise.resolve({ data: null }),
          ]);
          return Response.json({ import: imp, pages: pages ?? [], items: items ?? [], paper: paper ?? null });
        }

        const { data: imports, error } = await db
          .from("school_pdf_imports")
          .select("id,filename,page_count,status,paper_id,created_at,created_by")
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return jsonErr(error.message, 500);
        const paperIds = [...new Set((imports ?? []).map((row) => row.paper_id).filter(Boolean))] as string[];
        const { data: papers } = paperIds.length
          ? await db.from("mock_papers").select("id,slug,title,year,description,sort_order").in("id", paperIds)
          : { data: [] };
        const paperMap = new Map((papers ?? []).map((p) => [p.id, p]));
        const rows = await Promise.all(
          (imports ?? []).map(async (imp) => {
            const paper = imp.paper_id ? paperMap.get(imp.paper_id) ?? null : null;
            const [{ count: mcq }, { count: frq }, { data: firstPage }] = await Promise.all([
              paper
                ? db.from("paper_questions").select("question_id", { count: "exact", head: true }).eq("paper_id", paper.id)
                : Promise.resolve({ count: 0 }),
              paper
                ? db.from("paper_frqs").select("id", { count: "exact", head: true }).eq("paper_id", paper.id)
                : Promise.resolve({ count: 0 }),
              db.from("school_pdf_pages").select("image_url").eq("import_id", imp.id).eq("page_number", 1).maybeSingle(),
            ]);
            const exams = paper ? await paperExams(db, paper.id) : { error: null, open: [] as ExamRow[], count: 0 };
            const inPractice = paper ? await practiceIncluded(db, paper.id) : false;
            const inMockLibrary = !!paper && !paper.slug.startsWith("school-") && !paper.slug.startsWith("frq-");
            const retired = !!paper && paper.slug.startsWith("school-retired");
            return {
              ...imp,
              paper,
              mcq: mcq ?? 0,
              frq: frq ?? 0,
              thumb: firstPage?.image_url ?? null,
              promote_requested: !!(paper?.description ?? "").includes(PROMOTE_MARK),
              in_mock_library: inMockLibrary,
              retired,
              exam_count: exams.count,
              open_exams: exams.open,
              exam_unknown: !!exams.error,
              in_practice: inPractice,
            };
          }),
        );
        return Response.json({
          uploads: rows.filter((row) => !row.retired && (row.mcq > 0 || row.frq > 0 || !row.paper)),
        });
      },
      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const db = await adminDb(request);
        const body = (await request.json()) as {
          action?: "promote" | "keep-school" | "into-practice" | "delete-bank" | "delete-paper";
          import_id?: string;
          paper_id?: string;
          title?: string;
          slug?: string;
          into_practice?: boolean;
        };
        if (body.action === "delete-paper") {
          if (!body.paper_id || !isUuid(body.paper_id)) return jsonErr("missing paper_id");
          const result = await removeUnapprovedPaper(db, body.paper_id);
          if ("error" in result) return jsonErr(result.error ?? "删除失败", result.status);
          return Response.json({ ok: true, kept_scores: result.kept_scores });
        }
        if (!body.import_id || !isUuid(body.import_id)) return jsonErr("missing import_id");
        const { data: imp } = await db.from("school_pdf_imports").select("*").eq("id", body.import_id).maybeSingle();
        if (!imp?.paper_id) return jsonErr("还没有发布成试卷");
        const { data: paper } = await db.from("mock_papers").select("*").eq("id", imp.paper_id).maybeSingle();
        if (!paper) return jsonErr("试卷不存在");

        if (body.action === "keep-school") {
          const desc = (paper.description ?? "").replace(PROMOTE_MARK, "").trim() || "学校考试 · PDF 整页出图（人工校对后发布）";
          await db.from("mock_papers").update({ description: desc, sort_order: 910 }).eq("id", paper.id);
          return Response.json({ ok: true, paper });
        }

        if (body.action === "into-practice" || body.action === "delete-bank") {
          const exams = await paperExams(db, paper.id);
          if (exams.error) return jsonErr(exams.error, 500);
          if (body.action === "into-practice") {
            if (exams.open.length) return jsonErr(openExamMessage(exams.open, "纳入刷题库"));
            const included = await includeInPractice(db, paper.id);
            if (included) return jsonErr(included, 500);
            return Response.json({ ok: true });
          }
          const result = await removeUnapprovedPaper(db, paper.id);
          if ("error" in result) return jsonErr(result.error ?? "删除失败", result.status);
          return Response.json({ ok: true, kept_scores: result.kept_scores });
        }

        if (body.action !== "promote") return jsonErr("unknown action");
        const title = (body.title ?? paper.title).trim().slice(0, 120) || paper.title;
        const rawSlug = (body.slug ?? "").trim() || examSlugFromFilename(title || imp.filename);
        const slug = rawSlug.replace(/^-+|-+$/g, "").slice(0, 48);
        if (!slug || slug.startsWith("school-") || slug.startsWith("frq-")) return jsonErr("真题卷卷号无效");
        const year = Number(slug.match(/20\d{2}/)?.[0] ?? paper.year ?? new Date().getFullYear());

        const { data: exists } = await db.from("mock_papers").select("id,slug,title").eq("slug", slug).maybeSingle();
        let replaced: string | null = null;
        if (exists && exists.id !== paper.id) {
          const retireErr = await retirePaper(db, exists.id);
          if (retireErr) return jsonErr(`卷库已有 ${slug}，且无法替换：${retireErr.message}`);
          replaced = exists.title;
        }

        const official = /^ap-micro-20\d{2}$/.test(slug);
        const { error: uErr } = await db
          .from("mock_papers")
          .update({
            slug,
            title,
            year,
            sort_order: official ? Math.max(1, 2026 - year) : 20,
            description: official
              ? `官方 ${year} 年 AP 微观经济考试，60 道选择题（70 分钟）+ 3 道简答题。图表题只附对应表格或图。`
              : "官方真题 · 教师 PDF 上传，经管理员审核列入模拟考试真题库。",
          })
          .eq("id", paper.id);
        if (uErr) return jsonErr(uErr.message, 500);

        const intoPractice = !!body.into_practice;
        const { data: qids } = await db.from("paper_questions").select("question_id").eq("paper_id", paper.id);
        const ids = (qids ?? []).map((q) => q.question_id);
        if (ids.length > 0) {
          await db.from("questions").update({ exclude_from_pool: !intoPractice }).in("id", ids);
        }
        await db.from("paper_frqs").update({ exclude_from_pool: !intoPractice }).eq("paper_id", paper.id);

        const { data: fresh } = await db.from("mock_papers").select("id,slug,title,year").eq("id", paper.id).single();
        return Response.json({ ok: true, paper: fresh, into_practice: intoPractice, replaced });
      },
    },
  },
});
