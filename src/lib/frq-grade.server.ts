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

function scoreOf(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

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
      const obj = JSON.parse(a) as { total_score?: unknown };
      const total = scoreOf(obj?.total_score);
      if (obj && typeof obj === "object" && total != null) return { ...obj, total_score: total } as FrqGradeResult;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function clipPrompt(value: string | null | undefined, max: number) {
  const text = (value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

function httpsUrl(value: string | null | undefined) {
  const url = (value ?? "").trim();
  return url.startsWith("https://") ? url : "";
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
  const answerText = clipPrompt(input.answerText, 15000);
  const hasText = !!answerText;
  const fileUrl = httpsUrl(input.answerFileUrl);
  const figureUrl = httpsUrl(frq.image_url);
  const hasFile = !!fileUrl;
  const imageParts = splitImageTextRubric(frq.image_text);
  const gradingNote = clipPrompt(input.rubricNote?.trim() || imageParts.rubric, 8000);
  const userTextParts: string[] = [
    `【题号】Question ${frq.sort_order ?? ""}${frq.title ? ` · ${frq.title}` : ""}`,
    `【满分】${maxScore} 分`,
    `【题目原文】\n${clipPrompt(frq.content, 8000)}`,
  ];
  const figureText = clipPrompt(imageParts.imageText, 4000);
  if (figureText) userTextParts.push(`【题图中的文字】\n${figureText}`);
  if (gradingNote) {
    userTextParts.push(
      `【评分要点｜最高优先级】\n` +
        `以下内容是本题的参考答案和评分标准。必须逐条对照评分，不得自行新增、合并、省略或改写评分点；每个 breakdown 项必须与其中一个得分点一一对应。\n\n${gradingNote}`,
    );
  }
  if (hasText) userTextParts.push(`【学生文字答案】\n${answerText}`);
  if (hasFile) {
    if (input.answerFileKind === "image") userTextParts.push("【学生上传了一张答案图片，已附在下方，请直接读图评分】");
    else userTextParts.push("【学生另附了答案文件。请基于文字答案评分；没有文字时按未作答处理。】");
  }
  userTextParts.push(
    `【输出要求】仅输出一个 JSON 对象（不要 Markdown、不要 \`\`\` 代码块、不要解释文字），结构示例：\n` +
      `{"total_score": 数字, "max_score": ${maxScore}, "breakdown": [{"point":"得分点","awarded":true,"comment":"解释"}], "overall_comment":"中文整体评语", "suggestions":"中文改进建议"}\n` +
      `max_score 必须等于 ${maxScore}。total_score 必须是数字。\n` +
      `【文本格式硬性要求】所有字符串字段（point/comment/overall_comment/suggestions）只能包含中文、英文、数字与常见中英文标点，可少量使用 emoji（如 ✅ ❌ 💡 📌）；禁止任何 Markdown 符号（* _ ~ \` # >）、代码围栏或项目符号；禁止出现乱码。\n` +
      `【排版要求】overall_comment 与 suggestions 使用自然的中英文混排段落：每段聚焦一个要点，段落之间用一个空行（\\n\\n）分隔，段内换行用 \\n。禁止使用星号或"-"作为项目符号；如需列举可用"1) 2) 3)"或"首先/其次/最后"。`,
  );
  const userText = userTextParts.join("\n\n");
  const attempts: Array<{ model: string; figure: boolean; answerImage: boolean; jsonMode: boolean; timeoutMs: number }> = [
    { model: "google/gemini-2.5-flash", figure: true, answerImage: true, jsonMode: true, timeoutMs: 18000 },
    { model: "google/gemini-2.5-flash", figure: false, answerImage: false, jsonMode: false, timeoutMs: 15000 },
  ];
  let lastError = "ai_failed";
  const tried = new Set<string>();
  for (const attempt of attempts) {
    const images: Array<{ type: "image_url"; image_url: { url: string } }> = [];
    if (attempt.answerImage && hasFile && input.answerFileKind === "image") images.push({ type: "image_url", image_url: { url: fileUrl } });
    if (attempt.figure && figureUrl) images.push({ type: "image_url", image_url: { url: figureUrl } });
    const signature = `${attempt.model}:${attempt.jsonMode}:${images.map((image) => image.image_url.url).join("|")}`;
    if (tried.has(signature)) continue;
    tried.add(signature);
    const userContent = images.length ? [{ type: "text", text: userText }, ...images] : userText;
    let upstream: Response;
    try {
      upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(attempt.timeoutMs),
        body: JSON.stringify({
          model: attempt.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
          max_tokens: 3072,
          ...(attempt.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (error) {
      console.error("frq grade error", attempt.model, error);
      lastError = "ai_failed";
      continue;
    }
    if (upstream.status === 429) {
      lastError = "rate_limited";
      continue;
    }
    if (upstream.status === 402) return { ok: false, error: "credits_exhausted" };
    if (!upstream.ok) {
      console.error("frq grade error", attempt.model, upstream.status, (await upstream.text()).slice(0, 300));
      lastError = "ai_failed";
      continue;
    }
    const data = await upstream.json();
    const raw = String(data?.choices?.[0]?.message?.content ?? "");
    const parsed = tryParseJson(raw);
    if (!parsed) {
      lastError = "ai_failed";
      continue;
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
  return { ok: false, error: lastError };
}
