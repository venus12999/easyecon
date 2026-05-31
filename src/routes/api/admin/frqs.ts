import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const DEFAULT_PROMPT = `你是 AP Microeconomics（AP 微观经济）资深官方阅卷官（Reader），严格按 College Board 公布的 FRQ 评分指南（Scoring Guidelines / Rubric）逐项判分，专为中国学生服务。

严格规则：
1. 仅输出一个 JSON 对象，不要任何 Markdown 代码块、解释性前言或后记。
2. 紧扣 AP CED 大纲与微观经济学标准定义；保留专业术语英文原文（不可缩写，例如必须写 marginal cost，不能写 MC），中文评语可在术语后用括号附中文翻译。
3. 按官方 rubric 把每个 scoring point 拆开判分，逐点说明是否给分、为什么。
4. 学生答案可能是文字、图片中的手写内容或上传文件中的文字；都以学生最终表达的内容为准，结合题干、图中文字和评分指南综合判断。
5. 评分必须客观、严格，不要为了鼓励而放水；同时必须指出错误原因与正确做法。
6. 评语用简体中文撰写，分点清晰，避免空泛。

输出严格 JSON：
{
  "total_score": <整数，本题得分>,
  "max_score": <整数，本题满分，按用户输入>,
  "breakdown": [
    { "point": "<scoring point 简述，如 'Part (a)(i): correctly draws PPC'>", "awarded": <true|false>, "comment": "<为何给/不给该分>" }
  ],
  "overall_comment": "<对学生整体表现的简评，含主要扣分原因>",
  "suggestions": "<给学生的复习建议，紧扣 AP rubric>"
}`;

export const Route = createFileRoute("/api/admin/frqs")({
  server: {
    handlers: {
      // 列出全部真题卷 + FRQ + 当前 grader_prompt
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return err("unauthorized", 401);
        const [{ data: papers }, { data: frqs }, { data: settings }] = await Promise.all([
          supabaseAdmin
            .from("mock_papers")
            .select("id,slug,title,total_seconds,frq_seconds,break_seconds")
            .order("sort_order", { ascending: true }),
          supabaseAdmin
            .from("paper_frqs")
            .select("id,paper_id,sort_order,title,content,image_url,image_text,max_score,rubric_note")
            .order("sort_order", { ascending: true }),
          supabaseAdmin.from("admin_settings").select("frq_grader_prompt").eq("id", 1).maybeSingle(),
        ]);
        return Response.json({
          papers: papers ?? [],
          frqs: frqs ?? [],
          grader_prompt: settings?.frq_grader_prompt ?? DEFAULT_PROMPT,
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
          const patch: Record<string, unknown> = {};
          if (body.image_text !== undefined) patch.image_text = body.image_text;
          if (body.max_score !== undefined) patch.max_score = body.max_score;
          if (body.rubric_note !== undefined) patch.rubric_note = body.rubric_note;
          if (Object.keys(patch).length === 0) return err("nothing to update");
          const { error } = await supabaseAdmin.from("paper_frqs").update(patch).eq("id", body.id);
          if (error) return err(error.message, 500);
          return Response.json({ ok: true });
        }
        if (body.target === "paper") {
          if (!body.id) return err("missing id");
          const patch: Record<string, unknown> = {};
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
1. 把图片中所有可见文字、坐标轴标签、曲线/区域命名、表格内容逐字提取出来。
2. 保留原文（英文保留英文，禁止把术语缩写，例如必须写 marginal cost，不能写 MC）。
3. 输出排版尽量贴近原图：表格用 markdown 表格；坐标轴/曲线用 "Axes:" / "Curves:" / "Points:" 等分段说明。
4. 不要解释、不要翻译、不要添加任何与图中不存在的内容。
5. 若图中没有任何文字，输出 "（图中未发现可识别文字）"。`;

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