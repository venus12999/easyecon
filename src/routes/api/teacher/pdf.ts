import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonErr } from "@/lib/json-api";
import { ensureTeacherClass, getTeacherDb, uploadTeacherAssignmentImage, verifyTeacherRequest } from "@/lib/teacher-auth.server";
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
  needs_image?: boolean;
  image_url?: string | null;
};

function stripFences(s: string) {
  return s.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

async function aiReviewItems(items: PdfItemIn[]) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return Response.json({ findings: [], skipped: true, error: "AI 未配置，题目已自动切好，有问题再改即可。" });
  }
  const payload = items.map((it) => ({
    key: `${it.kind}-${it.sort_order}`,
    kind: it.kind,
    sort_order: it.sort_order,
    stem: (it.stem ?? "").slice(0, 500),
    options: it.kind === "mcq"
      ? { A: it.option_a, B: it.option_b, C: it.option_c, D: it.option_d, E: it.option_e }
      : undefined,
    content: it.kind === "frq" ? (it.content ?? "").slice(0, 500) : undefined,
    has_image: !!it.image_url,
    needs_image: !!it.needs_image,
    has_answer: !!(it.correct_answer ?? "").trim(),
  }));
  const sys = `你是 AP 微观经济试卷 OCR 质检员。题目已由程序按题号切开，请只标出「明显切坏/缺内容」的题，方便老师改那几道，不要逐题找茬。

只输出这些问题（key 必须原样返回）：
- 题干被切到下一题，或选项里混进了下一题题号
- 选择题缺少 A–D 中任一选项，或选项明显不是选项文本
- 题干提到 graph/table/figure/见图 但 has_image=false
- 大题正文过短（明显没切全）

不要：
- 不要猜正确答案，也不要因为没填答案而报警
- 不要建议润色措辞或知识点分类
- 不确定就不要输出该题`;

  const findings: Array<{ key: string; reason: string }> = [];
  const BATCH = 12;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: JSON.stringify(slice) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_pdf_issues",
              description: "仅返回明显有问题的题",
              parameters: {
                type: "object",
                properties: {
                  findings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        reason: { type: "string" },
                      },
                      required: ["key", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["findings"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_pdf_issues" } },
      }),
    });
    if (r.status === 429) return jsonErr("AI 调用过于频繁，请稍后再试", 429);
    if (r.status === 402) return jsonErr("AI 额度已用尽", 402);
    if (!r.ok) {
      const t = await r.text();
      return jsonErr(`AI 调用失败 (${r.status}): ${t.slice(0, 200)}`, 500);
    }
    const j = await r.json();
    const toolCall = j?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: { findings?: Array<{ key: string; reason: string }> } = {};
    try {
      const argStr = toolCall?.function?.arguments;
      parsed = argStr ? JSON.parse(argStr) : JSON.parse(stripFences(j?.choices?.[0]?.message?.content ?? "{}"));
    } catch {
      parsed = { findings: [] };
    }
    const allowed = new Set(slice.map((p) => p.key));
    findings.push(...(parsed.findings ?? []).filter((f) => allowed.has(f.key)));
  }
  return Response.json({ findings, total: items.length });
}

function mcqKey(raw: string | null | undefined) {
  const ans = (raw ?? "").trim().toUpperCase();
  return ["A", "B", "C", "D", "E"].includes(ans) ? ans : null;
}

async function loadImport(id: string, classId: string, db: SupabaseClient) {
  const { data: imp } = await db
    .from("school_pdf_imports")
    .select("id,class_id,filename,page_count,status,paper_id,created_at")
    .eq("id", id)
    .eq("class_id", classId)
    .maybeSingle();
  if (!imp) return null;
  const [{ data: pages }, { data: items }] = await Promise.all([
    db.from("school_pdf_pages").select("id,page_number,image_url,extracted_text").eq("import_id", id).order("page_number"),
    db.from("school_pdf_items").select("*").eq("import_id", id).order("sort_order"),
  ]);
  return { import: imp, pages: pages ?? [], items: items ?? [] };
}

export const Route = createFileRoute("/api/teacher/pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (id && isUuid(id)) {
          const packed = await loadImport(id, cls.id, db);
          if (!packed) return jsonErr("not found", 404);
          return Response.json(packed);
        }
        const { data } = await db
          .from("school_pdf_imports")
          .select("id,filename,page_count,status,paper_id,created_at")
          .eq("class_id", cls.id)
          .order("created_at", { ascending: false })
          .limit(30);
        return Response.json({ imports: data ?? [] });
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : "教师接口失败", 500);
        }
      },
      POST: async ({ request }) => {
        try {
        const u = await verifyTeacherRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const ctype = request.headers.get("content-type") ?? "";
        if (ctype.includes("multipart/form-data")) {
          const form = await request.formData();
          const file = form.get("file");
          const importId = String(form.get("import_id") ?? "");
          if (!(file instanceof File)) return jsonErr("missing file");
          if (!isUuid(importId)) return jsonErr("missing import_id");
          if (!ALLOWED.has(file.type)) return jsonErr("unsupported file type");
          if (file.size > MAX) return jsonErr("file too large");
          const packed = await loadImport(importId, cls.id, db);
          if (!packed) return jsonErr("not found", 404);
          const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
          const cropKind = String(form.get("crop_kind") ?? "");
          const sortOrder = Number(form.get("sort_order"));
          if (cropKind === "mcq" || cropKind === "frq") {
            if (!Number.isInteger(sortOrder) || sortOrder < 1) return jsonErr("invalid sort_order");
            const path = `assignments/${cls.id}/${importId}/${cropKind}-${sortOrder}.${ext}`;
            const up = await uploadTeacherAssignmentImage(u.jwt, path, file);
            if (up.error) return jsonErr(`题图上传失败：${up.error.message}`, 500);
            return Response.json({ image_url: up.publicUrl, kind: cropKind, sort_order: sortOrder });
          }
          const pageNumber = Number(form.get("page_number"));
          if (!Number.isInteger(pageNumber) || pageNumber < 1) return jsonErr("invalid page_number");
          const path = `assignments/${cls.id}/${importId}/page-${pageNumber}.${ext}`;
          const up = await uploadTeacherAssignmentImage(u.jwt, path, file);
          if (up.error) return jsonErr(`页图上传失败：${up.error.message}`, 500);
          const extracted = String(form.get("extracted_text") ?? "");
          const { error } = await db.from("school_pdf_pages").upsert(
            { import_id: importId, page_number: pageNumber, image_url: up.publicUrl, extracted_text: extracted || null },
            { onConflict: "import_id,page_number" },
          );
          if (error) return jsonErr(`页记录写入失败：${error.message}`, 500);
          return Response.json({ image_url: up.publicUrl, page_number: pageNumber });
        }

        const body = (await request.json()) as {
          action?: "create" | "save-items" | "publish" | "ai-review" | "record-page" | "delete" | "delete-drafts";
          filename?: string;
          page_count?: number;
          import_id?: string;
          items?: PdfItemIn[];
          title?: string;
          library?: "school" | "mock";
          slug?: string;
          item_images?: Record<string, string>;
          page_number?: number;
          image_url?: string;
          extracted_text?: string;
        };
        const action = body.action ?? "create";

        if (action === "create") {
          const filename = (body.filename ?? "exam.pdf").slice(0, 200);
          const pageCount = Number(body.page_count ?? 0);
          if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 80) return jsonErr("页数无效（1–80）");
          const { data, error } = await db
            .from("school_pdf_imports")
            .insert({
              class_id: cls.id,
              created_by: u.userId,
              filename,
              page_count: pageCount,
              status: "rendered",
            })
            .select("id,class_id,filename,page_count,status,paper_id,created_at")
            .single();
          if (error || !data) return jsonErr(`创建导入失败：${error?.message ?? "创建失败"}`, 500);
          return Response.json({ import: data });
        }

        if (action === "delete-drafts") {
          const { error } = await db
            .from("school_pdf_imports")
            .delete()
            .eq("class_id", cls.id)
            .neq("status", "published");
          if (error) return jsonErr(error.message, 500);
          return Response.json({ ok: true });
        }

        if (!body.import_id || !isUuid(body.import_id)) return jsonErr("missing import_id");
        const packed = await loadImport(body.import_id, cls.id, db);
        if (!packed) return jsonErr("not found", 404);

        if (action === "delete") {
          const { error } = await db
            .from("school_pdf_imports")
            .delete()
            .eq("id", packed.import.id)
            .eq("class_id", cls.id);
          if (error) return jsonErr(error.message, 500);
          return Response.json({ ok: true });
        }

        if (packed.import.status === "published") return jsonErr("已发布，不能再改");

        if (action === "record-page") {
          const pageNumber = Number(body.page_number);
          const imageUrl = String(body.image_url ?? "");
          if (!Number.isInteger(pageNumber) || pageNumber < 1) return jsonErr("invalid page_number");
          if (!imageUrl.startsWith("https://")) return jsonErr("invalid image_url");
          const extracted = String(body.extracted_text ?? "");
          const { error } = await db.from("school_pdf_pages").upsert(
            { import_id: packed.import.id, page_number: pageNumber, image_url: imageUrl, extracted_text: extracted || null },
            { onConflict: "import_id,page_number" },
          );
          if (error) return jsonErr(`页记录写入失败：${error.message}`, 500);
          return Response.json({ image_url: imageUrl, page_number: pageNumber });
        }

        if (action === "save-items") {
          const items = Array.isArray(body.items) ? body.items : [];
          await db.from("school_pdf_items").delete().eq("import_id", packed.import.id);
          if (items.length > 0) {
            const { error } = await db.from("school_pdf_items").insert(
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
          await db.from("school_pdf_imports").update({ status: "reviewing" }).eq("id", packed.import.id);
          return Response.json(await loadImport(packed.import.id, cls.id, db));
        }

        if (action === "ai-review") {
          const source = Array.isArray(body.items) ? body.items : packed.items;
          return aiReviewItems(
            source.map((it) => ({
              ...it,
              kind: it.kind === "frq" ? "frq" : "mcq",
            })),
          );
        }

        if (action === "publish") {
          const fresh = await loadImport(packed.import.id, cls.id, db);
          if (!fresh) return jsonErr("not found", 404);
          if (fresh.items.length === 0) return jsonErr("请先按页切题");
          const pageMap = new Map(fresh.pages.map((p) => [p.page_number, p]));
          const images = body.item_images ?? {};
          const { data: kp } = await db.from("knowledge_points").select("id").eq("slug", "school-import").maybeSingle();
          if (!kp) return jsonErr("缺少 school-import 知识点，请先执行数据库迁移", 500);

          const mcqs = fresh.items.filter((it) => it.kind === "mcq");
          const frqs = fresh.items.filter((it) => it.kind === "frq");
          for (const it of mcqs) {
            if (!it.option_a || !it.option_b || !it.option_c || !it.option_d) return jsonErr(`第 ${it.sort_order} 题选项不完整`);
            if (!pageMap.get(it.page_number)?.image_url) return jsonErr(`第 ${it.page_number} 页还没有页图`);
          }

          const title = (body.title ?? fresh.import.filename.replace(/\.pdf$/i, "")).trim().slice(0, 120) || "学校考试卷";
          const slug = `school-${crypto.randomUUID().slice(0, 8)}`;
          const description = "学校考试 · 教师 PDF 导入，等待管理员审核是否列入题库。";
          const year = Number(title.match(/20\d{2}/)?.[0] ?? fresh.import.filename.match(/20\d{2}/)?.[0] ?? new Date().getFullYear());
          const inserted = await db
            .from("mock_papers")
            .insert({
              slug,
              title,
              description,
              year,
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
              const crop = images[`${it.kind}-${it.sort_order}`];
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
                correct_answer: mcqKey(it.correct_answer),
                explanation: `${year} AP 微观经济真题第 ${it.sort_order} 题。`,
                image_url: crop || null,
                status: "published" as const,
                exclude_from_pool: true,
              };
            });
            const { data: qs, error: qErr } = await db.from("questions").insert(rows).select("id");
            if (qErr || !qs) return jsonErr(qErr?.message ?? "题目写入失败", 500);
            const { error: pqErr } = await db.from("paper_questions").insert(
              qs.map((q, i) => ({ paper_id: paper.id, question_id: q.id, sort_order: i + 1 })),
            );
            if (pqErr) return jsonErr(pqErr.message, 500);
          }
          if (frqs.length > 0) {
            const { error: fErr } = await db.from("paper_frqs").insert(
              frqs.map((it, i) => {
                const page = pageMap.get(it.page_number);
                const crop = images[`${it.kind}-${it.sort_order}`];
                return {
                  paper_id: paper.id,
                  sort_order: i + 1,
                  title: (it.stem ?? "").trim() || `FRQ ${i + 1}`,
                  content: (it.content ?? it.stem ?? "").trim() || `见第 ${it.page_number} 页`,
                  image_url: crop || null,
                  image_text: page?.extracted_text ?? null,
                  max_score: it.max_score ?? 9,
                  exclude_from_pool: true,
                };
              }),
            );
            if (fErr) return jsonErr(fErr.message, 500);
          }

          await db
            .from("school_pdf_imports")
            .update({ status: "published", paper_id: paper.id })
            .eq("id", fresh.import.id);
          return Response.json({ paper, import_id: fresh.import.id });
        }

        return jsonErr("unknown action");
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : "教师接口失败", 500);
        }
      },
    },
  },
});
