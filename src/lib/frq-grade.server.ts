import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { splitImageTextRubric } from "@/lib/frq-teacher-fields";

export type FrqBreakdown = { point: string; awarded: boolean; comment: string };

export type FrqGradeResult = {
  total_score: number;
  max_score: number;
  breakdown: FrqBreakdown[];
  overall_comment: string;
  suggestions: string;
};

type FrqRow = {
  title: string | null;
  content: string | null;
  image_url: string | null;
  image_text: string | null;
  max_score: number | null;
  sort_order: number | null;
};

function tryParseJson(raw: string): FrqGradeResult | null {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const attempts: string[] = [stripped];
  const s = stripped.indexOf("{");
  const e = stripped.lastIndexOf("}");
  if (s !== -1 && e > s) attempts.push(stripped.substring(s, e + 1));
  attempts.forEach((a) => {
    const fixed = a.replace(/,(\s*[}\]])/g, "$1");
    if (fixed !== a) attempts.push(fixed);
  });
  for (const a of attempts) {
    try {
      const obj = JSON.parse(a);
      if (obj && typeof obj === "object" && typeof obj.total_score === "number") return obj as FrqGradeResult;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function sanitizeText(s: unknown): string {
  if (typeof s !== "string") return "";
  let out = s
    .replace(/```+/g, "")
    .replace(/[*_~`#>]+/g, "")
    .replace(/^\s*[-•+]+\s?/gm, "")
    .replace(/[\uFFFD\uE000-\uF8FF]/g, "");
  out = out.replace(
    /[^\u4E00-\u9FFF\u3400-\u4DBF\uFF00-\uFF65\u3000-\u303F\w\s.,;:!?()\[\]{}"'/%\-+=<>@¥$&|·—…“”‘’、。，；：！？（）《》【】\u2600-\u27BF\u2B00-\u2BFF\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u200D\uFE0F]/gu,
    "",
  );
  out = out
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function sanitizeGrade(g: FrqGradeResult): FrqGradeResult {
  return {
    ...g,
    breakdown: (g.breakdown ?? []).map((b) => ({
      point: sanitizeText(b.point),
      awarded: !!b.awarded,
      comment: sanitizeText(b.comment),
    })),
    overall_comment: sanitizeText(g.overall_comment),
    suggestions: sanitizeText(g.suggestions),
  };
}

export async function gradeFrqAnswer(input: {
  frq: FrqRow;
  rubricNote: string | null;
  answerText: string | null;
  answerFileUrl: string | null;
  answerFileKind: string | null;
}): Promise<{ ok: true; grade: FrqGradeResult } | { ok: false; error: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, error: "ai_not_configured" };
  const { data: settings } = await supabaseAdmin.from("admin_settings").select("frq_grader_prompt").eq("id", 1).maybeSingle();
  const system = settings?.frq_grader_prompt?.trim() || "你是 AP 微观经济资深阅卷官，按官方 rubric 评分，输出 JSON。";
  const frq = input.frq;
  const maxScore = frq.max_score ?? 9;
  const hasText = !!(input.answerText && input.answerText.trim());
  const hasFile = !!input.answerFileUrl;
  const imageParts = splitImageTextRubric(frq.image_text);
  const gradingNote = input.rubricNote?.trim() || imageParts.rubric;
  const userTextParts: string[] = [
    `【题号】Question ${frq.sort_order ?? ""}${frq.title ? ` · ${frq.title}` : ""}`,
    `【满分】${maxScore} 分`,
    `【题目原文】\n${frq.content ?? ""}`,
  ];
  if (imageParts.imageText) userTextParts.push(`【题图中的文字】\n${imageParts.imageText}`);
  if (gradingNote) {
    userTextParts.push(
      `【评分要点｜最高优先级】\n` +
        `以下内容是本题的参考答案和评分标准。必须逐条对照评分，不得自行新增、合并、省略或改写评分点；每个 breakdown 项必须与其中一个得分点一一对应。\n\n${gradingNote}`,
    );
  }
  if (hasText) userTextParts.push(`【学生文字答案】\n${input.answerText}`);
  if (hasFile) {
    if (input.answerFileKind === "image") userTextParts.push("【学生上传了一张答案图片，已附在下方，请直接读图评分】");
    else userTextParts.push(`【学生上传的答案文件 URL】\n${input.answerFileUrl}\n（若你无法读取，请基于已提供的文字答案评分；若无文字答案则按"未作答"扣分。）`);
  }
  userTextParts.push(
    `【输出要求】仅输出一个 JSON 对象（不要 Markdown、不要 \`\`\` 代码块、不要解释文字），结构示例：\n` +
      `{"total_score": 数字, "max_score": ${maxScore}, "breakdown": [{"point":"得分点","awarded":true,"comment":"解释"}], "overall_comment":"中文整体评语", "suggestions":"中文改进建议"}\n` +
      `max_score 必须等于 ${maxScore}。\n` +
      `【文本格式硬性要求】所有字符串字段（point/comment/overall_comment/suggestions）只能包含中文、英文、数字与常见中英文标点，可少量使用 emoji（如 ✅ ❌ 💡 📌）；禁止任何 Markdown 符号（* _ ~ \` # >）、代码围栏或项目符号；禁止出现乱码。\n` +
      `【排版要求】overall_comment 与 suggestions 使用自然的中英文混排段落：每段聚焦一个要点，段落之间用一个空行（\\n\\n）分隔，段内换行用 \\n。禁止使用星号或"-"作为项目符号；如需列举可用"1) 2) 3)"或"首先/其次/最后"。`,
  );
  const userText = userTextParts.join("\n\n");
  const userContent: unknown =
    hasFile && input.answerFileKind === "image"
      ? [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: input.answerFileUrl } },
          ...(frq.image_url ? [{ type: "image_url", image_url: { url: frq.image_url } }] : []),
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
  if (upstream.status === 429) return { ok: false, error: "rate_limited" };
  if (upstream.status === 402) return { ok: false, error: "credits_exhausted" };
  if (!upstream.ok) {
    console.error("frq grade error", upstream.status, await upstream.text());
    return { ok: false, error: "ai_failed" };
  }
  const data = await upstream.json();
  const raw = String(data?.choices?.[0]?.message?.content ?? "");
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      ok: true,
      grade: {
        total_score: 0,
        max_score: maxScore,
        breakdown: [],
        overall_comment: "AI 没有返回可用的评语。可以稍后重试，或由教师直接给分。",
        suggestions: "",
      },
    };
  }
  const clean = sanitizeGrade(parsed);
  return {
    ok: true,
    grade: {
      ...clean,
      total_score: Math.max(0, Math.min(maxScore, Math.round(clean.total_score))),
      max_score: maxScore,
    },
  };
}
