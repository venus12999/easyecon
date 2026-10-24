import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonErr } from "@/lib/json-api";
import { frqExtractGap, readableFrqLabel, shapeOfficialFrq, studentVisibleQuestion, withUniqueQuestionNumbers } from "@/lib/ap-exam-parse";
import { withPageImage, withPointMarker } from "@/lib/exam-flags";
import { packTeacherFrq, splitTeacherFrq, teacherGradingNote, withTeacherRubric } from "@/lib/frq-teacher-fields";
import { fileToVisionPage, rewriteFrqFromPage, visionParseExamPages } from "@/lib/pdf-vision.server";
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
  rubric_note?: string | null;
};

function stripFences(s: string) {
  return s.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

function optionsComplete(it: PdfItemIn) {
  return it.kind === "mcq" && [it.option_a, it.option_b, it.option_c, it.option_d].every((s) => (s ?? "").trim().length > 0);
}

function claimsMissingOptions(reason: string) {
  return /缺少\s*A|A\s*[–—-]\s*D|任一选项|选项不完整|没有\s*[A-D]\s*选项|missing option/i.test(reason);
}

function claimsMissingImage(reason: string) {
  return /has_image\s*=\s*false|缺图|缺少图表|没有配图|没有图表|未附图表|没有截图|需要补图/i.test(reason);
}

function itemHasFigure(it: PdfItemIn) {
  const url = (it.image_url ?? "").trim();
  if (!url) return false;
  if (url.startsWith("blob:")) return true;
  return !/\/page-\d+\.(png|jpe?g|webp)(?:$|\?)/i.test(url);
}

async function aiReviewItems(items: PdfItemIn[]) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return Response.json({ findings: [], skipped: true, error: "AI 未配置，题目已自动切好，有问题再改即可。" });
  }
  const complete = new Set(items.filter(optionsComplete).map((it) => `${it.kind}-${it.sort_order}`));
  const payload = items.map((it) => ({
    key: `${it.kind}-${it.sort_order}`,
    kind: it.kind,
    sort_order: it.sort_order,
    stem: (it.stem ?? "").slice(0, 500),
    options: it.kind === "mcq"
      ? { A: it.option_a, B: it.option_b, C: it.option_c, D: it.option_d, E: it.option_e }
      : undefined,
    options_ok: optionsComplete(it),
    content: it.kind === "frq" ? (it.content ?? "").slice(0, 1800) : undefined,
    content_chars: it.kind === "frq" ? (it.content ?? "").trim().length : undefined,
    has_image: itemHasFigure(it),
    needs_image: !!it.needs_image,
    has_answer: !!(it.correct_answer ?? "").trim(),
  }));
  const sys = `你是 AP 微观经济试卷 OCR 质检员。题目已由程序按题号切开，请只标出「明显切坏/缺内容」的题，方便老师改那几道，不要逐题找茬。

只输出这些问题（key 必须原样返回）：
- 题干被切到下一题，或选项里混进了下一题题号
- 仅当 options_ok 为 false 时，才可以说选择题缺少 A–D。options_ok 为 true 时，禁止写「缺少选项」或「缺少 A–D」
- 选项文本明显不是选项（例如整段题干被塞进某一个选项）
- 仅当 needs_image 为 true 且 has_image 为 false，题干又明确提到已经印出的 graph/table/figure/见图 时，才报告缺图。理由写「题干提到图表，但没有配图」。has_image 为 true 时禁止报告缺图，也不要写出 has_image=false
- 大题正文过短（明显没切全）。只在 content_chars 不到 400、小问序号中间缺了（有 (a) 和 (e) 却没有 (b) 或 (c)）、或某一问停在半个词上时才报。下标写成 P_f、P_f2 是正常的，不要当成乱码。不要因为预览没贴全文就说没切全

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
    const imaged = new Set(slice.filter((p) => p.has_image).map((p) => p.key));
    findings.push(
      ...(parsed.findings ?? []).filter((f) => {
        if (!allowed.has(f.key)) return false;
        if (complete.has(f.key) && claimsMissingOptions(f.reason ?? "")) return false;
        if (imaged.has(f.key) && claimsMissingImage(f.reason ?? "")) return false;
        return true;
      }),
    );
  }
  return Response.json({ findings, total: items.length });
}

async function repairShortFrqs(
  items: PdfItemIn[],
  pages: Array<{ page_number: number; image_url?: string | null }>,
) {
  const repairs: Array<{ key: string; content: string; stem: string; complete: boolean }> = [];
  const next = items.map((item) => ({ ...item }));
  const jobs = next.filter((item) => item.kind === "frq" && frqExtractGap(item.content ?? ""));
  await Promise.all(jobs.slice(0, 4).map(async (item) => {
    const before = item.content ?? "";
    const sort = item.sort_order;
    const page = pages.find((row) => row.page_number === item.page_number);
    const rewritten = await rewriteFrqFromPage({
      imageUrl: page?.image_url ?? "",
      content: before,
      sort,
      stem: item.stem ?? "",
    });
    const cleaned = shapeOfficialFrq(before);
    const content = rewritten || (cleaned !== before.trim() ? cleaned : "");
    if (!content || content === before.trim()) return;
    item.content = content;
    item.stem = readableFrqLabel(item.stem ?? "", content, sort);
    repairs.push({ key: `frq-${sort}`, content, stem: item.stem, complete: !frqExtractGap(content) });
  }));
  return { items: next, repairs };
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
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
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
        const ids = (data ?? []).map((row) => row.id);
        const { data: itemRows } = ids.length
          ? await db.from("school_pdf_items").select("import_id").in("import_id", ids)
          : { data: [] as { import_id: string }[] };
        const counts = new Map<string, number>();
        for (const row of itemRows ?? []) counts.set(row.import_id, (counts.get(row.import_id) ?? 0) + 1);
        return Response.json({
          imports: (data ?? []).map((row) => ({ ...row, item_count: counts.get(row.id) ?? 0 })),
        });
        } catch (e) {
          return jsonErr(e instanceof Error ? e.message : "教师接口失败", 500);
        }
      },
      POST: async ({ request }) => {
        try {
        const u = await verifyTeacherRequest(request);
        if (u === "expired") return jsonErr("session_expired", 401);
        if (u === "unavailable") return jsonErr("unavailable", 503);
        if (!u) return jsonErr("unauthorized", 401);
        const db = await getTeacherDb(u.jwt);
        const cls = await ensureTeacherClass(u.userId, db);
        const ctype = request.headers.get("content-type") ?? "";
        if (ctype.includes("multipart/form-data")) {
          const form = await request.formData();
          if (String(form.get("action") ?? "") === "vision-parse") {
            const importId = String(form.get("import_id") ?? "");
            if (!isUuid(importId)) return jsonErr("missing import_id");
            const packed = await loadImport(importId, cls.id, db);
            if (!packed) return jsonErr("not found", 404);
            const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 8);
            if (files.length === 0) return jsonErr("没有页图");
            const pages = [];
            for (const file of files) {
              if (!ALLOWED.has(file.type)) return jsonErr("页图格式不支持");
              if (file.size > 3 * 1024 * 1024) return jsonErr("某一页图片太大，请换一份更小的 PDF");
              const text = String(form.get(`text-${file.name.match(/page-(\d+)/i)?.[1] ?? ""}`) ?? "");
              const page = await fileToVisionPage(file, text);
              if (!page.page_number) return jsonErr("页码无效");
              pages.push(page);
            }
            pages.sort((a, b) => a.page_number - b.page_number);
            return Response.json(await visionParseExamPages(pages));
          }
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
          if (items.length === 0) {
            await db.from("school_pdf_imports").update({ status: "rendered" }).eq("id", packed.import.id);
            return jsonErr("没有认出题目");
          }
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
                content: it.kind === "frq"
                  ? packTeacherFrq(it.content, it.rubric_note ?? splitTeacherFrq(it.content).rubric_note)
                  : (it.content ?? null),
                max_score: it.kind === "mcq" ? Number(it.max_score) || 1 : Number(it.max_score) > 0 ? Number(it.max_score) : 0,
                reviewed: !!it.reviewed,
              })),
            );
            if (error) return jsonErr(error.message, 500);
          }
          await db.from("school_pdf_imports").update({ status: "reviewing" }).eq("id", packed.import.id);
          return Response.json(await loadImport(packed.import.id, cls.id, db));
        }

        if (action === "ai-review") {
          const source = (Array.isArray(body.items) ? body.items : packed.items).map((it) => ({
            ...it,
            kind: it.kind === "frq" ? "frq" as const : "mcq" as const,
          }));
          const { items: repairedItems, repairs } = await repairShortFrqs(source, packed.pages);
          const reviewed = await aiReviewItems(repairedItems);
          const payload = await reviewed.json().catch(() => ({ error: "AI 审核没有返回结果" })) as { findings?: Array<{ key: string; reason: string }> };
          if (!reviewed.ok && repairs.length === 0) return Response.json(payload, { status: reviewed.status });
          const findings = [...(payload.findings ?? [])];
          const seen = new Set(findings.map((finding) => finding.key));
          for (const fix of repairs) {
            if (fix.complete || seen.has(fix.key)) continue;
            findings.push({ key: fix.key, reason: "大题正文过短（明显没切全）" });
          }
          return Response.json({ ...payload, findings, repairs });
        }

        if (action === "publish") {
          const fresh = await loadImport(packed.import.id, cls.id, db);
          if (!fresh) return jsonErr("not found", 404);
          if (fresh.items.length === 0) return jsonErr("没有题目，不能提交");
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
          const numberedMcqs = withUniqueQuestionNumbers(mcqs);
          const numberedFrqs = withUniqueQuestionNumbers(frqs);
          const missingScore = numberedFrqs.find((it) => !(Number(it.max_score) >= 1));
          if (missingScore) return jsonErr(`Q${missingScore.sort_order} 还没有满分。卷面没认出分值时请老师先填上，再提交。`);

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

          if (numberedMcqs.length > 0) {
            const rows = numberedMcqs.map((it) => {
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
                explanation: withPageImage(
                  withPointMarker(`${year} AP 微观经济真题第 ${it.sort_order} 题。`, it.max_score ?? 1),
                  pageMap.get(it.page_number)?.image_url,
                ),
                image_url: crop || null,
                status: "published" as const,
                exclude_from_pool: true,
              };
            });
            const { data: qs, error: qErr } = await db.from("questions").insert(rows).select("id");
            if (qErr || !qs) return jsonErr(qErr?.message ?? "题目写入失败", 500);
            const { error: pqErr } = await db.from("paper_questions").insert(
              qs.map((q, i) => ({ paper_id: paper.id, question_id: q.id, sort_order: numberedMcqs[i]?.sort_order ?? i + 1 })),
            );
            if (pqErr) return jsonErr(pqErr.message, 500);
          }
          if (numberedFrqs.length > 0) {
            const frqRows = numberedFrqs.map((it) => {
              const page = pageMap.get(it.page_number);
              const crop = images[`${it.kind}-${it.sort_order}`];
              const unpacked = splitTeacherFrq(it.content);
              const grading = teacherGradingNote(it.correct_answer, unpacked.rubric_note);
              return {
                paper_id: paper.id,
                sort_order: it.sort_order,
                title: readableFrqLabel(it.stem ?? "", unpacked.content, it.sort_order),
                content: studentVisibleQuestion(unpacked.content, page?.extracted_text ?? "")
                  || studentVisibleQuestion(it.stem ?? "", page?.extracted_text ?? "")
                  || `见第 ${it.page_number} 页`,
                image_url: crop || null,
                image_text: withPageImage(withTeacherRubric(page?.extracted_text, grading), page?.image_url),
                max_score: Number(it.max_score),
                exclude_from_pool: true,
                grading,
              };
            });
            const { data: insertedFrqs, error: fErr } = await db.from("paper_frqs").insert(
              frqRows.map((row) => ({
                paper_id: row.paper_id,
                sort_order: row.sort_order,
                title: row.title,
                content: row.content,
                image_url: row.image_url,
                image_text: row.image_text,
                max_score: row.max_score,
                exclude_from_pool: row.exclude_from_pool,
              })),
            ).select("id, sort_order");
            if (fErr || !insertedFrqs) return jsonErr(fErr?.message ?? "大题写入失败", 500);
            for (const frq of insertedFrqs) {
              const grading = frqRows.find((row) => row.sort_order === frq.sort_order)?.grading ?? "";
              if (!grading) continue;
              await db.from("paper_frq_rubrics").upsert({ frq_id: frq.id, rubric_note: grading });
            }
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
