import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyToken } from "@/lib/admin-token.server";

type AuditFinding = {
  question_id: string;
  current_type: string;
  current_kp_slug: string;
  current_kp_zh: string;
  suggested_type?: string;
  suggested_kp_slug?: string;
  reason: string;
  stem_preview: string;
};

function unauth() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function stripFences(s: string) {
  return s.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

export const Route = createFileRoute("/api/admin/audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyToken(request.headers.get("x-admin-token"))) return unauth();

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY 未配置" }), { status: 500 });
        }

        const { data: kps } = await supabaseAdmin
          .from("knowledge_points")
          .select("id,slug,name_zh,name_en,unit")
          .order("sort_order");
        const { data: questions } = await supabaseAdmin
          .from("questions")
          .select("id,knowledge_point_id,type,stem,option_a,option_b,option_c,option_d,correct_answer");
        const kpList = kps ?? [];
        const qList = questions ?? [];
        const kpById = new Map(kpList.map((k) => [k.id, k]));

        const kpDirectory = kpList
          .map((k) => `- slug=${k.slug} | ${k.name_zh}（${k.name_en}）unit ${k.unit}`)
          .join("\n");

        // 分批送给 AI，避免 prompt 过长。每批 8 题。
        const findings: AuditFinding[] = [];
        const batchSize = 8;
        for (let i = 0; i < qList.length; i += batchSize) {
          const batch = qList.slice(i, i + batchSize);
          const itemsForAi = batch.map((q) => {
            const kp = kpById.get(q.knowledge_point_id);
            return {
              id: q.id,
              current_type: q.type,
              current_kp_slug: kp?.slug ?? "",
              stem: q.stem.slice(0, 600),
              options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
              correct: q.correct_answer,
            };
          });

          const sys = `你是 AP 微观经济学题库审核专家。任务：对每道题判定其「题型分类」与「知识点归属」是否正确。

题型定义（必须严格区分）：
- basic（基础）：考察术语定义、概念辨析、单一概念识别。
- application（应用）：要求结合数据、图表、情境进行分析，多步推理或计算。
- pitfall（易错）：典型混淆点（如 shift vs movement、名义 vs 实际、normal vs inferior good 在收入上升时方向），常考学生易错的反直觉点。

可用的知识点 slug 列表如下，必须从中选择：
${kpDirectory}

对每题输出一个 JSON 对象。当前分类已正确则不要输出该题。仅输出需要修改的题。
`;

          const usr = `请审核以下题目（仅输出存在问题的）：
${JSON.stringify(itemsForAi, null, 2)}`;

          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: sys },
                { role: "user", content: usr },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "report_audit",
                    description: "返回需要修改的题目清单",
                    parameters: {
                      type: "object",
                      properties: {
                        findings: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              question_id: { type: "string" },
                              suggested_type: {
                                type: "string",
                                enum: ["basic", "application", "pitfall", "keep"],
                              },
                              suggested_kp_slug: { type: "string" },
                              reason: { type: "string" },
                            },
                            required: ["question_id", "reason"],
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
              tool_choice: { type: "function", function: { name: "report_audit" } },
            }),
          });

          if (r.status === 429) {
            return new Response(JSON.stringify({ error: "AI 调用过于频繁，请稍后再试" }), { status: 429 });
          }
          if (r.status === 402) {
            return new Response(JSON.stringify({ error: "AI 额度已用尽" }), { status: 402 });
          }
          if (!r.ok) {
            const t = await r.text();
            return new Response(JSON.stringify({ error: `AI 调用失败 (${r.status}): ${t.slice(0, 200)}` }), { status: 500 });
          }

          const j = await r.json();
          const toolCall = j?.choices?.[0]?.message?.tool_calls?.[0];
          let parsed: { findings?: Array<{ question_id: string; suggested_type?: string; suggested_kp_slug?: string; reason: string }> } = {};
          try {
            const argStr = toolCall?.function?.arguments;
            if (argStr) {
              parsed = JSON.parse(argStr);
            } else {
              const raw = j?.choices?.[0]?.message?.content ?? "";
              parsed = JSON.parse(stripFences(raw));
            }
          } catch {
            // 跳过本批
            continue;
          }

          for (const f of parsed.findings ?? []) {
            const q = batch.find((x) => x.id === f.question_id);
            if (!q) continue;
            const kp = kpById.get(q.knowledge_point_id);
            const suggestedType = f.suggested_type && f.suggested_type !== "keep" ? f.suggested_type : undefined;
            const suggestedSlug = f.suggested_kp_slug && f.suggested_kp_slug !== kp?.slug ? f.suggested_kp_slug : undefined;
            if (!suggestedType && !suggestedSlug) continue;
            findings.push({
              question_id: q.id,
              current_type: q.type,
              current_kp_slug: kp?.slug ?? "",
              current_kp_zh: kp?.name_zh ?? "",
              suggested_type: suggestedType,
              suggested_kp_slug: suggestedSlug,
              reason: f.reason,
              stem_preview: q.stem.slice(0, 120),
            });
          }
        }

        return Response.json({ findings, total: qList.length });
      },
    },
  },
});