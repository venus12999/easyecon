import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { consumeAiQuota, membershipEnvironment, releaseAiQuota } from "@/lib/membership.server";

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Body = {
  frq_id: string;
  paper_id: string;
  mode: "exam" | "practice";
  answer_text?: string | null;
  answer_file_url?: string | null;
  answer_file_kind?: "image" | "pdf" | "doc" | "text" | null;
};

type Breakdown = { point: string; awarded: boolean; comment: string };
type Grade = {
  total_score: number;
  max_score: number;
  breakdown: Breakdown[];
  overall_comment: string;
  suggestions: string;
};

function tryParseJson(raw: string): Grade | null {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const attempts: string[] = [stripped];
  const s = stripped.indexOf("{");
  const e = stripped.lastIndexOf("}");
  if (s !== -1 && e > s) attempts.push(stripped.substring(s, e + 1));
  // 尝试修复常见尾随逗号
  attempts.forEach((a) => {
    const fixed = a.replace(/,(\s*[}\]])/g, "$1");
    if (fixed !== a) attempts.push(fixed);
  });
  for (const a of attempts) {
    try {
      const obj = JSON.parse(a);
      if (obj && typeof obj === "object" && typeof obj.total_score === "number") {
        return obj as Grade;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export const Route = createFileRoute("/api/frq/grade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return err("unauthorized", 401);
        const body = (await request.json()) as Body;
        if (!body.frq_id || !body.paper_id || !body.mode) return err("missing fields");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.frq_id) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.paper_id) ||
            !["exam", "practice"].includes(body.mode)) return err("invalid fields");
        if (body.answer_text && body.answer_text.length > 30000) return err("答案文字过长");
        const hasText = !!(body.answer_text && body.answer_text.trim());
        const hasFile = !!body.answer_file_url;
        if (!hasText && !hasFile) return err("请填写或上传答案");
        if (hasFile) {
          let fileUrl: URL;
          try {
            fileUrl = new URL(body.answer_file_url!);
          } catch {
            return err("invalid file URL");
          }
          const storageBase = process.env.SUPABASE_URL;
          if (!storageBase) return err("storage unavailable", 500);
          const allowedPrefix = `${storageBase.replace(/\/$/, "")}/storage/v1/object/public/question-images/frq-answers/${u.userId}/${body.paper_id}/${body.frq_id}/`;
          if (!fileUrl.href.startsWith(allowedPrefix)) return err("invalid file URL");
        }

        const [{ data: frq, error: e1 }, { data: rubric }] = await Promise.all([
          supabaseAdmin
            .from("paper_frqs")
            .select("id,paper_id,title,content,image_url,image_text,max_score,sort_order")
            .eq("id", body.frq_id)
            .eq("paper_id", body.paper_id)
            .maybeSingle(),
          supabaseAdmin
            .from("paper_frq_rubrics")
            .select("rubric_note")
            .eq("frq_id", body.frq_id)
            .maybeSingle(),
        ]);
        if (e1 || !frq) return err("frq not found", 404);

        const { data: settings } = await supabaseAdmin
          .from("admin_settings")
          .select("frq_grader_prompt")
          .eq("id", 1)
          .maybeSingle();
        const system = settings?.frq_grader_prompt?.trim() || "你是 AP 微观经济资深阅卷官，按官方 rubric 评分，输出 JSON。";

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return err("AI 未配置", 500);
         const quota = await consumeAiQuota(supabaseAdmin, u.userId, "frq_grade", membershipEnvironment(request));
         if (!quota.allowed) return err("membership_quota_exhausted", 403);

        const maxScore = frq.max_score ?? 9;
        const userTextParts: string[] = [
          `【题号】Question ${frq.sort_order}${frq.title ? ` · ${frq.title}` : ""}`,
          `【满分】${maxScore} 分`,
          `【题目原文】\n${frq.content ?? ""}`,
        ];
        if (frq.image_text) userTextParts.push(`【题图中的文字】\n${frq.image_text}`);
        if (rubric?.rubric_note) {
          userTextParts.push(
            `【College Board 官方评分要点｜最高优先级】\n` +
              `以下 rubric 是本题随附的官方得分点。必须逐条对照评分，不得自行新增、合并、省略或改写评分点；每个 breakdown 项必须与其中一个得分点一一对应。\n\n${rubric.rubric_note}`,
          );
        }
        if (hasText) userTextParts.push(`【学生文字答案】\n${body.answer_text}`);
        if (hasFile) {
          if (body.answer_file_kind === "image") {
            userTextParts.push(`【学生上传了一张答案图片，已附在下方，请直接读图评分】`);
          } else {
            userTextParts.push(`【学生上传的答案文件 URL】\n${body.answer_file_url}\n（若你无法读取，请基于已提供的文字答案评分；若无文字答案则按"未作答"扣分。）`);
          }
        }
        userTextParts.push(
          `【输出要求】仅输出一个 JSON 对象（不要 Markdown、不要 \`\`\` 代码块、不要解释文字），结构示例：\n` +
            `{"total_score": 数字, "max_score": ${maxScore}, "breakdown": [{"point":"得分点","awarded":true,"comment":"解释"}], "overall_comment":"中文整体评语", "suggestions":"中文改进建议"}\n` +
            `max_score 必须等于 ${maxScore}。`,
        );
        const userText = userTextParts.join("\n\n");

        const userContent: unknown =
          hasFile && body.answer_file_kind === "image"
            ? [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: body.answer_file_url } },
                ...(frq.image_url
                  ? [{ type: "image_url", image_url: { url: frq.image_url } }]
                  : []),
              ]
            : frq.image_url
              ? [
                  { type: "text", text: userText },
                  { type: "image_url", image_url: { url: frq.image_url } },
                ]
              : userText;

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
              { role: "user", content: userContent },
            ],
            max_tokens: 3072,
            response_format: { type: "json_object" },
          }),
        });
        if (upstream.status === 429) {
          await releaseAiQuota(supabaseAdmin, u.userId, "frq_grade");
          return err("rate_limited", 429);
        }
        if (upstream.status === 402) {
          await releaseAiQuota(supabaseAdmin, u.userId, "frq_grade");
          return err("credits_exhausted", 402);
        }
        if (!upstream.ok) {
          const t = await upstream.text();
          console.error("frq grade error", upstream.status, t);
          await releaseAiQuota(supabaseAdmin, u.userId, "frq_grade");
          return err("ai_failed", 500);
        }
        const data = await upstream.json();
        const raw = String(data?.choices?.[0]?.message?.content ?? "");
        const grade = tryParseJson(raw);
        if (!grade) {
          await releaseAiQuota(supabaseAdmin, u.userId, "frq_grade");
          return Response.json({
            total_score: 0,
            max_score: maxScore,
            breakdown: [],
            overall_comment: "AI 评分返回的内容不是规范的 JSON，已为你保留 0 分占位。请稍后重试，或换一种方式提交答案（例如把图片换成清晰版本，或补充文字说明）。",
            suggestions: "AI 返回格式异常，请重试或联系管理员。",
          });
        }
        // 兜底夹紧分数
        const total = Math.max(0, Math.min(maxScore, Math.round(grade.total_score)));

        // 持久化（使用 service role，但记录 user_id）
        await supabaseAdmin.from("frq_submissions").insert({
          user_id: u.userId,
          paper_id: body.paper_id,
          frq_id: body.frq_id,
          mode: body.mode,
          answer_text: body.answer_text ?? null,
          answer_file_url: body.answer_file_url ?? null,
          answer_file_kind: body.answer_file_kind ?? (hasText ? "text" : null),
          ai_score: total,
          ai_max_score: maxScore,
          ai_breakdown: grade.breakdown ?? [],
          ai_overall: grade.overall_comment ?? "",
          ai_suggestions: grade.suggestions ?? "",
        });

        return Response.json({
          total_score: total,
          max_score: maxScore,
          breakdown: grade.breakdown ?? [],
          overall_comment: grade.overall_comment ?? "",
          suggestions: grade.suggestions ?? "",
        });
      },
    },
  },
});