import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonErr } from "@/lib/json-api";
import { ensureTeacherClass, verifyTeacherRequest } from "@/lib/teacher-auth.server";
import { isUuid } from "@/lib/school-exam-session";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX = 8 * 1024 * 1024;

type PdfItemIn = {
  id?: string;
  kind: "mcq" | "frq";
  sort_order: number;
  page_number: number;
  stem?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer?: string | null;
  content?: string | null;
  max_score?: number;
  reviewed?: boolean;
};

async function loadImport(id: string, classId: string) {
  const { data: imp } = await supabaseAdmin
    .from("school_pdf_imports")
    .select("id,class_id,filename,page_count,status,paper_id,created_at")
    .eq("id", id)
    .eq("class_id", classId)
    .maybeSingle();
  if (!imp) return null;
  const [{ data: pages }, { data: items }] = await Promise.all([
    supabaseAdmin.from("school_pdf_pages").select("id,page_number,image_url,extracted_text").eq("import_id", id).order("page_number"),
    supabaseAdmin.from("school_pdf_items").select("*").eq("import_id", id).order("sort_order"),
  ]);
  return { import: imp, pages: pages ?? [], items: items ?? [] };
}

export const Route = createFileRoute("/api/teacher/pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const cls = await ensureTeacherClass(u.userId);
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (id && isUuid(id)) {
          const packed = await loadImport(id, cls.id);
          if (!packed) return jsonErr("not found", 404);
          return Response.json(packed);
        }
        const { data } = await supabaseAdmin
          .from("school_pdf_imports")
          .select("id,filename,page_count,status,paper_id,created_at")
          .eq("class_id", cls.id)
          .order("created_at", { ascending: false })
          .limit(30);
        return Response.json({ imports: data ?? [] });
      },
      POST: async ({ request }) => {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const cls = await ensureTeacherClass(u.userId);
        const ctype = request.headers.get("content-type") ?? "";
        if (ctype.includes("multipart/form-data")) {
          const form = await request.formData();
          const file = form.get("file");
          const importId = String(form.get("import_id") ?? "");
          const pageNumber = Number(form.get("page_number"));
          if (!(file instanceof File)) return jsonErr("missing file");
          if (!isUuid(importId)) return jsonErr("missing import_id");
          if (!Number.isInteger(pageNumber) || pageNumber < 1) return jsonErr("invalid page_number");
          if (!ALLOWED.has(file.type)) return jsonErr("unsupported file type");
          if (file.size > MAX) return jsonErr("file too large");
          const packed = await loadImport(importId, cls.id);
          if (!packed) return jsonErr("not found", 404);
          const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
          const path = `assignments/${cls.id}/${importId}/page-${pageNumber}.${ext}`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("question-images")
            .upload(path, file, { contentType: file.type, upsert: true });
          if (upErr) return jsonErr(upErr.message, 500);
          const { data: pub } = supabaseAdmin.storage.from("question-images").getPublicUrl(path);
          const extracted = String(form.get("extracted_text") ?? "");
          const { error } = await supabaseAdmin.from("school_pdf_pages").upsert(
            { import_id: importId, page_number: pageNumber, image_url: pub.publicUrl, extracted_text: extracted || null },
            { onConflict: "import_id,page_number" },
          );
          if (error) return jsonErr(error.message, 500);
          return Response.json({ image_url: pub.publicUrl, page_number: pageNumber });
        }

        const body = (await request.json()) as {
          action?: "create" | "save-items" | "publish";
          filename?: string;
          page_count?: number;
          import_id?: string;
          items?: PdfItemIn[];
          title?: string;
          library?: "school" | "mock";
          slug?: string;
          promote_requested?: boolean;
        };
        const action = body.action ?? "create";

        if (action === "create") {
          const filename = (body.filename ?? "exam.pdf").slice(0, 200);
          const pageCount = Number(body.page_count ?? 0);
          if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 80) return jsonErr("页数无效（1–80）");
          const { data, error } = await supabaseAdmin
            .from("school_pdf_imports")
            .insert({
              class_id: cls.id,
              created_by: u.userId,
              filename,
              page_count: pageCount,
              status: "rendered",
            })
            .select("id,filename,page_count,status,paper_id,created_at")
            .single();
          if (error || !data) return jsonErr(error?.message ?? "创建失败", 500);
          return Response.json({ import: data });
        }

        if (!body.import_id || !isUuid(body.import_id)) return jsonErr("missing import_id");
        const packed = await loadImport(body.import_id, cls.id);
        if (!packed) return jsonErr("not found", 404);
        if (packed.import.status === "published") return jsonErr("已发布，不能再改");

        if (action === "save-items") {
          const items = Array.isArray(body.items) ? body.items : [];
          await supabaseAdmin.from("school_pdf_items").delete().eq("import_id", packed.import.id);
          if (items.length > 0) {
            const { error } = await supabaseAdmin.from("school_pdf_items").insert(
              items.map((it, i) => ({
                import_id: packed.import.id,
                kind: it.kind,
                sort_order: it.sort_order ?? i + 1,
                page_number: it.page_number,
                stem: it.stem ?? null,
                option_a: it.option_a ?? null,
                option_b: it.option_b ?? null,
                option_c: it.option_c ?? null,
                option_d: it.option_d ?? null,
                option_e: it.option_e ?? null,
                correct_answer: it.correct_answer ?? null,
                content: it.content ?? null,
                max_score: it.max_score ?? 9,
                reviewed: !!it.reviewed,
              })),
            );
            if (error) return jsonErr(error.message, 500);
          }
          await supabaseAdmin.from("school_pdf_imports").update({ status: "reviewing" }).eq("id", packed.import.id);
          return Response.json(await loadImport(packed.import.id, cls.id));
        }

        if (action === "publish") {
          const fresh = await loadImport(packed.import.id, cls.id);
          if (!fresh) return jsonErr("not found", 404);
          if (fresh.items.length === 0) return jsonErr("请先按页切题");
          if (fresh.items.some((it) => !it.reviewed)) return jsonErr("请先校对全部题目后再发布");
          const pageMap = new Map(fresh.pages.map((p) => [p.page_number, p]));
          const { data: kp } = await supabaseAdmin.from("knowledge_points").select("id").eq("slug", "school-import").maybeSingle();
          if (!kp) return jsonErr("缺少 school-import 知识点，请先执行数据库迁移", 500);

          const mcqs = fresh.items.filter((it) => it.kind === "mcq");
          const frqs = fresh.items.filter((it) => it.kind === "frq");
          for (const it of mcqs) {
            const ans = (it.correct_answer ?? "").trim().toUpperCase();
            if (!["A", "B", "C", "D", "E"].includes(ans)) return jsonErr(`第 ${it.sort_order} 题请填写正确答案`);
            if (!it.option_a || !it.option_b || !it.option_c || !it.option_d) return jsonErr(`第 ${it.sort_order} 题选项不完整`);
            if (!pageMap.get(it.page_number)?.image_url) return jsonErr(`第 ${it.page_number} 页还没有页图`);
          }

          const title = (body.title ?? fresh.import.filename.replace(/\.pdf$/i, "")).trim().slice(0, 120) || "学校考试卷";
          const promoteRequested = !!body.promote_requested || body.library === "mock";
          const slug = `school-${crypto.randomUUID().slice(0, 8)}`;
          const description = promoteRequested
            ? "【申请列入模拟考试真题库】学校考试 · PDF 导入，等待管理员在后台审核。"
            : "学校考试 · PDF 整页出图（人工校对后发布）";
          const inserted = await supabaseAdmin
            .from("mock_papers")
            .insert({
              slug,
              title,
              description,
              year: new Date().getFullYear(),
              total_seconds: 70 * 60,
              frq_seconds: 60 * 60,
              break_seconds: 10 * 60,
              sort_order: 910,
            })
            .select("id,slug,title")
            .single();
          if (inserted.error || !inserted.data) return jsonErr(inserted.error?.message ?? "无法创建试卷", 500);
          const paper = inserted.data;

          if (mcqs.length > 0) {
            const rows = mcqs.map((it) => {
              const page = pageMap.get(it.page_number);
              return {
                knowledge_point_id: kp.id,
                type: "application" as const,
                difficulty: 2,
                stem: (it.stem ?? "").trim() || `第 ${it.page_number} 页`,
                option_a: it.option_a!,
                option_b: it.option_b!,
                option_c: it.option_c!,
                option_d: it.option_d!,
                option_e: it.option_e || null,
                correct_answer: (it.correct_answer ?? "A").trim().toUpperCase(),
                explanation: "学校考试导入题，见页图。",
                image_url: page?.image_url ?? null,
                status: "published" as const,
                exclude_from_pool: true,
              };
            });
            const { data: qs, error: qErr } = await supabaseAdmin.from("questions").insert(rows).select("id");
            if (qErr || !qs) return jsonErr(qErr?.message ?? "题目写入失败", 500);
            const { error: pqErr } = await supabaseAdmin.from("paper_questions").insert(
              qs.map((q, i) => ({ paper_id: paper.id, question_id: q.id, sort_order: i + 1 })),
            );
            if (pqErr) return jsonErr(pqErr.message, 500);
          }
          if (frqs.length > 0) {
            const { error: fErr } = await supabaseAdmin.from("paper_frqs").insert(
              frqs.map((it, i) => {
                const page = pageMap.get(it.page_number);
                return {
                  paper_id: paper.id,
                  sort_order: i + 1,
                  title: (it.stem ?? "").trim() || `FRQ ${i + 1}`,
                  content: (it.content ?? it.stem ?? "").trim() || `见第 ${it.page_number} 页`,
                  image_url: page?.image_url ?? null,
                  image_text: page?.extracted_text ?? null,
                  max_score: it.max_score ?? 9,
                  exclude_from_pool: true,
                };
              }),
            );
            if (fErr) return jsonErr(fErr.message, 500);
          }

          await supabaseAdmin
            .from("school_pdf_imports")
            .update({ status: "published", paper_id: paper.id })
            .eq("id", fresh.import.id);
          return Response.json({ paper, import_id: fresh.import.id });
        }

        return jsonErr("unknown action");
      },
    },
  },
});
