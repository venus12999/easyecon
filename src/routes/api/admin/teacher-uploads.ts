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
  const { data: oldQs } = await db.from("paper_questions").select("question_id").eq("paper_id", paperId);
  await db.from("paper_frqs").delete().eq("paper_id", paperId);
  await db.from("paper_questions").delete().eq("paper_id", paperId);
  const ids = (oldQs ?? []).map((q) => q.question_id);
  if (ids.length === 0) return;
  await db.from("questions").update({ exclude_from_pool: true }).in("id", ids);
  await db.from("questions").delete().in("id", ids);
}

async function retirePaper(db: SupabaseClient, paperId: string) {
  await dropPaperItems(db, paperId);
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
          action?: "promote" | "keep-school";
          import_id?: string;
          title?: string;
          slug?: string;
          into_practice?: boolean;
        };
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
