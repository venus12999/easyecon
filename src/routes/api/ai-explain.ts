import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { consumeAiQuota, membershipEnvironment, releaseAiQuota } from "@/lib/membership.server";

const jsonHeaders = { "Content-Type": "application/json" };

export const Route = createFileRoute("/api/ai-explain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await verifyUserRequest(request);
          if (!user) {
            return new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: jsonHeaders,
            });
          }
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
          if (
            typeof question !== "string" ||
            question.trim().length === 0 ||
            question.length > 1000 ||
            !context ||
            typeof context.stem !== "string" ||
            context.stem.length > 10000 ||
            typeof context.explanation !== "string" ||
            context.explanation.length > 10000
          ) {
            return new Response(JSON.stringify({ error: "缺少参数" }), {
              status: 400,
              headers: jsonHeaders,
            });
          }
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "AI 未配置" }), {
              status: 500,
              headers: jsonHeaders,
            });
          }
           const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
           const quota = await consumeAiQuota(
             supabaseAdmin,
             user.userId,
             "ai_explain",
             membershipEnvironment(request),
           );
           if (!quota.allowed) {
             return new Response(JSON.stringify({ error: "membership_quota_exhausted", ...quota }), {
               status: 403,
               headers: jsonHeaders,
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
            await releaseAiQuota(supabaseAdmin, user.userId, "ai_explain");
            return new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: jsonHeaders,
            });
          }
          if (upstream.status === 402) {
            await releaseAiQuota(supabaseAdmin, user.userId, "ai_explain");
            return new Response(JSON.stringify({ error: "credits_exhausted" }), {
              status: 402,
              headers: jsonHeaders,
            });
          }
          if (!upstream.ok || !upstream.body) {
            const t = await upstream.text();
            console.error("AI gateway error", upstream.status, t);
            await releaseAiQuota(supabaseAdmin, user.userId, "ai_explain");
            return new Response(JSON.stringify({ error: "ai_failed" }), {
              status: 500,
              headers: jsonHeaders,
            });
          }
          let streamText: string;
          try {
            streamText = await upstream.text();
          } catch (error) {
            console.error("AI stream interrupted", error);
            await releaseAiQuota(supabaseAdmin, user.userId, "ai_explain");
            return new Response(JSON.stringify({ error: "ai_failed" }), { status: 500, headers: jsonHeaders });
          }
          if (!streamText.includes("[DONE]")) {
            await releaseAiQuota(supabaseAdmin, user.userId, "ai_explain");
            return new Response(JSON.stringify({ error: "ai_failed" }), { status: 500, headers: jsonHeaders });
          }
          return new Response(streamText, {
            headers: { "Content-Type": "text/event-stream" },
          });
        } catch (e) {
          console.error("ai-explain error", e);
          return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500,
            headers: jsonHeaders,
          });
        }
      },
    },
  },
});