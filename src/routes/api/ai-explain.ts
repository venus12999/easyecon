import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

export const Route = createFileRoute("/api/ai-explain")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { question, context } = body as {
            question: string;
            context: {
              stem: string;
              options: { A: string; B: string; C: string; D: string };
              correct: string;
              explanation: string;
            };
          };
          if (!question || !context) {
            return new Response(JSON.stringify({ error: "缺少参数" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "AI 未配置" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const system = `你是 AP 微观经济（AP Microeconomics）资深答疑助手，专为中国学生服务。
严格规则：
1. 只用简体中文回答，必要时保留英文术语并附中文翻译。
2. 不要修改或质疑题目的"正确答案"——以题库给出的正确答案为准，你只负责解释。
3. 紧扣 AP CED（Course and Exam Description）大纲与微观经济学标准定义。
4. 学生若问"为什么不选 X"，请围绕该选项错在哪里、易混点、概念辨析展开。
5. 涉及 shift/movement、price ceiling/floor、elastic/inelastic 等易混词时，主动给出区分要点。
6. 回答控制在 200 字以内，分点清晰，避免空泛。`;

          const userMsg = `【题目】\n${context.stem}\n\n【选项】\nA. ${context.options.A}\nB. ${context.options.B}\nC. ${context.options.C}\nD. ${context.options.D}\n\n【正确答案】${context.correct}\n\n【官方解析】\n${context.explanation}\n\n【学生提问】\n${question}`;

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: system },
                { role: "user", content: userMsg },
              ],
              stream: true,
            }),
          });

          if (upstream.status === 429) {
            return new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (upstream.status === 402) {
            return new Response(JSON.stringify({ error: "credits_exhausted" }), {
              status: 402,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (!upstream.ok || !upstream.body) {
            const t = await upstream.text();
            console.error("AI gateway error", upstream.status, t);
            return new Response(JSON.stringify({ error: "ai_failed" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          return new Response(upstream.body, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        } catch (e) {
          console.error("ai-explain error", e);
          return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});