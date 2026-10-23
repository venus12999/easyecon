import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";
import { FRQ_GRADER_PROMPT } from "@/lib/frq-grade.server";

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DEFAULT_PROMPT = FRQ_GRADER_PROMPT;

export const Route = createFileRoute("/api/admin/frqs")({
  server: {
    handlers: {
      // 列出全部真题卷 + FRQ + 当前 grader_prompt
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);
        const [{ data: papers }, { data: frqs }, { data: rubrics }] = await Promise.all([
          supabaseAdmin
            .from("mock_papers")
            .select("id,slug,title,total_seconds,frq_seconds,break_seconds")
            .order("sort_order", { ascending: true }),
          supabaseAdmin
            .from("paper_frqs")
            .select("id,paper_id,sort_order,title,content,image_url,image_text,max_score")
            .order("sort_order", { ascending: true }),
          supabaseAdmin.from("paper_frq_rubrics").select("frq_id,rubric_note"),
        ]);
        const rubricByFrq = new Map((rubrics ?? []).map((row) => [row.frq_id, row.rubric_note]));
        return Response.json({
          papers: papers ?? [],
          frqs: (frqs ?? []).map((frq) => ({ ...frq, rubric_note: rubricByFrq.get(frq.id) ?? null })),
          grader_prompt: DEFAULT_PROMPT,
          default_prompt: DEFAULT_PROMPT,
        });
      },

      // 更新：FRQ 字段（image_text/max_score/rubric_note）或全局 grader_prompt 或 卷的 frq_seconds/break_seconds
      PATCH: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);
        const body = (await request.json()) as {
          target: "frq" | "prompt" | "paper";
          id?: string;
          image_text?: string | null;
          max_score?: number;
          rubric_note?: string | null;
          grader_prompt?: string;
          frq_seconds?: number;
          break_seconds?: number;
        };
        if (body.target === "prompt") {
          const prompt = (body.grader_prompt ?? "").trim();
          if (!prompt) return err("grader_prompt 不能为空");
          const { error } = await supabaseAdmin
            .from("admin_settings")
            .update({ frq_grader_prompt: prompt })
            .eq("id", 1);
          if (error) return err(error.message, 500);
          return Response.json({ ok: true });
        }
        if (body.target === "frq") {
          if (!body.id) return err("missing id");
          const patch: { image_text?: string | null; max_score?: number } = {};
          if (body.image_text !== undefined) patch.image_text = body.image_text;
          if (body.max_score !== undefined) patch.max_score = body.max_score;
          if (Object.keys(patch).length > 0) {
            const { error } = await supabaseAdmin.from("paper_frqs").update(patch).eq("id", body.id);
            if (error) return err(error.message, 500);
          }
          if (body.rubric_note !== undefined) {
            const { error } = await supabaseAdmin.from("paper_frq_rubrics").upsert({
              frq_id: body.id,
              rubric_note: body.rubric_note,
            });
            if (error) return err(error.message, 500);
          }
          if (Object.keys(patch).length === 0 && body.rubric_note === undefined) return err("nothing to update");
          return Response.json({ ok: true });
        }
        if (body.target === "paper") {
          if (!body.id) return err("missing id");
          const patch: { frq_seconds?: number; break_seconds?: number } = {};
          if (body.frq_seconds !== undefined) patch.frq_seconds = body.frq_seconds;
          if (body.break_seconds !== undefined) patch.break_seconds = body.break_seconds;
          if (Object.keys(patch).length === 0) return err("nothing to update");
          const { error } = await supabaseAdmin.from("mock_papers").update(patch).eq("id", body.id);
          if (error) return err(error.message, 500);
          return Response.json({ ok: true });
        }
        return err("unknown target");
      },

      // 触发 AI 识别 FRQ 图片中的文字，写入 image_text
      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);
        const { id } = (await request.json()) as { id: string };
        if (!id) return err("missing id");
        const { data: frq, error: e1 } = await supabaseAdmin
          .from("paper_frqs")
          .select("id,image_url,content")
          .eq("id", id)
          .maybeSingle();
        if (e1 || !frq) return err("frq not found", 404);
        if (!frq.image_url) return err("该题没有图片");

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return err("AI 未配置", 500);

        const system = `你是 AP 微观经济（AP Microeconomics）官方真题图片 OCR 助手。
严格规则：
1. 先把图片里印出的题目文字逐字抽出来。长度和分段严格照 2022 年 AP 微观大题：一道大约 1100 到 1600 个字符，先一段题干，再写 (a)(b)(c)…，小问用 i. ii. iii. 另起一行。不要翻译，不要用 Markdown，不要加星号，不要项目符号，不要「写出计算过程」，不要把整页或下一题接进来。
2. 如果图片里有图表，只摘图表内部的文字：坐标轴标签、曲线名称、表格格子。不要把整页试卷描述一遍，也不要把题干再抄进图表说明。
3. 页脚、页码、小红书水印、红书号可以忽略，不要写出来。有水印不影响使用这张图。
4. 保留原文（英文保留英文，禁止把术语缩写，例如必须写 marginal cost，不能写 MC）。
5. 表格用 HTML table。坐标轴和曲线用「坐标轴：」「曲线：」「点：」分段，每段只写图上真的印了的字。
6. 不要解释、不要翻译、不要添加图中没有的内容。
7. 若图中没有任何文字，输出 "（图中未发现可识别文字）"。`;

        const userMsg = `请提取这张 AP 微观 FRQ 题图中的所有文字。题干补充上下文（供参考，不要把它写进结果里）：\n${frq.content ?? ""}`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  { type: "text", text: userMsg },
                  { type: "image_url", image_url: { url: frq.image_url } },
                ],
              },
            ],
            max_tokens: 2048,
          }),
        });
        if (upstream.status === 429) return err("rate_limited", 429);
        if (upstream.status === 402) return err("credits_exhausted", 402);
        if (!upstream.ok) {
          const t = await upstream.text();
          console.error("frq ocr error", upstream.status, t);
          return err("ai_failed", 500);
        }
        const data = await upstream.json();
        const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
        const { error: e2 } = await supabaseAdmin
          .from("paper_frqs")
          .update({ image_text: text })
          .eq("id", id);
        if (e2) return err(e2.message, 500);
        return Response.json({ image_text: text });
      },
    },
  },
});