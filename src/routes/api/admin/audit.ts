import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";

type AuditFinding = {
  question_id: string;
  current_type: string;
  current_kp_slug: string;
  current_kp_zh: string;
  suggested_type?: string;
  suggested_kp_slug?: string;
  reason: string;
  confidence: number;
  key_evidence?: string;
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
        if (!(await verifyAdminRequest(request))) return unauth();

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY 未配置" }), { status: 500 });
        }

        // 前端按批调用：可传入 question_ids 限定本次审核哪些题
        let requestedIds: string[] | null = null;
        try {
          const body = await request.json().catch(() => ({}));
          if (Array.isArray(body?.question_ids) && body.question_ids.length > 0) {
            requestedIds = body.question_ids.filter((x: unknown) => typeof x === "string");
          }
        } catch {
          // ignore
        }

        const { data: kps } = await supabaseAdmin
          .from("knowledge_points")
          .select("id,slug,name_zh,name_en,unit")
          .order("sort_order");
        let qQuery = supabaseAdmin
          .from("questions")
          .select("id,knowledge_point_id,type,stem,option_a,option_b,option_c,option_d,option_e,correct_answer");
        if (requestedIds) qQuery = qQuery.in("id", requestedIds);
        const { data: questions } = await qQuery;
        const kpList = kps ?? [];
        const qList = questions ?? [];
        const kpById = new Map(kpList.map((k) => [k.id, k]));

        const kpDirectory = kpList
          .map((k) => `- slug=${k.slug} | ${k.name_zh}（${k.name_en}）unit ${k.unit}`)
          .join("\n");

        // 单次调用一批 AI（前端控制分批，避免单个 HTTP 请求超过网关 30s 超时）
        const findings: AuditFinding[] = [];
        const batchSize = qList.length; // 整批一次性送
        for (let i = 0; i < qList.length; i += batchSize) {
          const batch = qList.slice(i, i + batchSize);
          const itemsForAi = batch.map((q) => {
            const kp = kpById.get(q.knowledge_point_id);
            return {
              id: q.id,
              current_type: q.type,
              current_kp_slug: kp?.slug ?? "",
              current_kp_zh: kp?.name_zh ?? "",
              stem: q.stem.slice(0, 600),
              options: {
                A: q.option_a,
                B: q.option_b,
                C: q.option_c,
                D: q.option_d,
                ...(q.option_e ? { E: q.option_e } : {}),
              },
              correct: q.correct_answer,
            };
          });

          const sys = `你是 AP 微观经济学题库审核专家。任务：审核每道题的「题型」与「知识点」当前分类是否**明显错误**。

【核心原则 — 极度保守】
- 默认动作 = **保留现状**。当前分类必须存在「明显且无可争议」的错误，才能给出建议。
- 如果一道题的当前分类「合理但非最佳」、或「也可以归到另一个相邻类别」，**必须保留**，不要输出。
- 不要因为个人风格偏好（例如你觉得另一个 slug 更精确）而提建议。判断尺度要稳定可复现：同一题目无论审核多少次，都应给出同样的判定。
- 你的输出会被批量应用到数据库；过度建议会导致管理员陷入「应用→重审→又出建议」的死循环。务必克制。

【题型严格定义】
- basic（基础）：题干只考察术语定义、概念识别、单一事实。无情境/无数据/无多步推理。
- application（应用）：必须满足以下任一：(a) 给出具体数字/价格/数量需要计算；(b) 给出具体情境/案例需结合多个概念分析；(c) 含图表（题干出现「graph / figure / 见图 / 见原 PDF / [此题含图]」等标记）。
- pitfall（易错）：题目专门设计用来考察经典反直觉混淆点，例如 shift vs movement along curve、normal vs inferior good、名义 vs 实际、accounting vs economic profit、price ceiling 在均衡价之上无效 等。**仅当题目明显围绕这些经典陷阱**时才用此类。

【知识点（仅可从下表 slug 中选择）】
${kpDirectory}
- 仅当当前 kp 与题目内容**完全不相关**或**明显归错单元**时才建议更换。
- 同一单元内的相邻 kp 之间的细微归属差异，**一律保留现状**。

【输出规则】
- 对每条建议必须给出 confidence（1–5 整数）：5=显然错误，4=很可能错误，3=有待商榷，1–2=只是不同看法。
- **只输出 confidence ≥ 4 的建议**。confidence ≤ 3 的题一律不要出现在 findings 里。
- 当前分类正确或仅小有出入：**不要输出该题**。
- 不要重复或猜测；如果不确定，宁可不输出。
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
              temperature: 0,
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
                              confidence: { type: "integer", minimum: 1, maximum: 5 },
                              key_evidence: {
                                type: "string",
                                description: "题干或选项中决定改判的关键短语原文（10-40字），用于高亮展示给管理员",
                              },
                              reason: { type: "string" },
                            },
                            required: ["question_id", "confidence", "key_evidence", "reason"],
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
          let parsed: {
            findings?: Array<{
              question_id: string;
              suggested_type?: string;
              suggested_kp_slug?: string;
              confidence?: number;
              key_evidence?: string;
              reason: string;
            }>;
          } = {};
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
            // 只接受高置信度建议（≥4），过滤模型噪声，避免反复出现
            if (typeof f.confidence === "number" && f.confidence < 4) continue;
            findings.push({
              question_id: q.id,
              current_type: q.type,
              current_kp_slug: kp?.slug ?? "",
              current_kp_zh: kp?.name_zh ?? "",
              suggested_type: suggestedType,
              suggested_kp_slug: suggestedSlug,
              reason: f.reason,
              confidence: typeof f.confidence === "number" ? f.confidence : 4,
              key_evidence: f.key_evidence,
              stem_preview: q.stem.slice(0, 120),
            });
          }
        }

        return Response.json({ findings, total: qList.length });
      },
    },
  },
});