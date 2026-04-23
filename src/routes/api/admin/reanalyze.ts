import { createFileRoute } from "@tanstack/react-router";
import { verifyToken } from "@/lib/admin-token.server";

function unauth() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/reanalyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyToken(request.headers.get("x-admin-token"))) return unauth();
        try {
          const body = (await request.json()) as {
            stem: string;
            option_a: string;
            option_b: string;
            option_c: string;
            option_d: string;
            correct_answer: "A" | "B" | "C" | "D";
            image_url?: string | null;
          };
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "AI 未配置" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const hasImage = !!body.image_url;
          const system = `你是 AP 微观经济（AP Microeconomics）资深命题分析专家，专为中国学生编写题库解析。
严格规则：
1. 只用简体中文输出 JSON，不要任何 Markdown 代码块包裹。
2. 紧扣 AP CED 大纲与微观经济学标准定义。
3. 解析需点出正确答案为何正确，并简要说明其它选项的错误所在。
4. 若你判断题库给出的正确答案与你分析不一致，仍需以题库为准撰写解析，但在 pitfall_note 字段提示"建议复核：本题正确答案疑为 X"。
5. 解析控制在 200 字以内，分点清晰。
${hasImage ? "6. 本题附带图片（图表/曲线/表格），必须先读图再结合题干分析，解析中需引用图中关键信息（如曲线移动方向、均衡点变化、表格数值等）。" : ""}
输出严格 JSON 格式：{"explanation": "...", "pitfall_note": "..."}（pitfall_note 可为空字符串）`;

          const userMsg = `【题目】\n${body.stem}\n\n【选项】\nA. ${body.option_a}\nB. ${body.option_b}\nC. ${body.option_c}\nD. ${body.option_d}\n\n【题库标记的正确答案】${body.correct_answer}`;

          const userContent: unknown = hasImage
            ? [
                { type: "text", text: userMsg },
                { type: "image_url", image_url: { url: body.image_url } },
              ]
            : userMsg;

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: system },
                { role: "user", content: userContent },
              ],
            }),
          });

          if (upstream.status === 429) {
            return new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (upstream.status === 402) {
            return new Response(JSON.stringify({ error: "credits_exhausted" }), {
              status: 402,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (!upstream.ok) {
            const t = await upstream.text();
            console.error("AI gateway error", upstream.status, t);
            return new Response(JSON.stringify({ error: "ai_failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const data = await upstream.json();
          const content = data?.choices?.[0]?.message?.content ?? "{}";
          let parsed: { explanation?: string; pitfall_note?: string } = {};
          // 提取 JSON：先去掉 markdown 包裹，再截取首个 { 到最后一个 }
          const stripFences = (s: string) =>
            s.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
          const tryParse = (s: string) => {
            try {
              return JSON.parse(s);
            } catch {
              return null;
            }
          };
          let raw = stripFences(String(content));
          let obj = tryParse(raw);
          if (!obj) {
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start !== -1 && end > start) {
              obj = tryParse(raw.substring(start, end + 1));
            }
          }
          if (obj && typeof obj === "object") {
            parsed = obj as { explanation?: string; pitfall_note?: string };
          } else {
            // 兜底：把全部文本作为 explanation
            parsed = { explanation: raw };
          }

          return Response.json({
            explanation: parsed.explanation ?? "",
            pitfall_note: parsed.pitfall_note ?? "",
          });
        } catch (e) {
          console.error("reanalyze error", e);
          return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
