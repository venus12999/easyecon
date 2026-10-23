import { looksLikeProvidedFigure, officialFrqMax, printedQuestionNumber, readPrintedScore, recoverOptionE, studentVisibleQuestion, withUniqueQuestionNumbers } from "@/lib/ap-exam-parse";

export type VisionExamItem = {
  kind: "mcq" | "frq";
  sort_order: number;
  page_number: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  content: string;
  max_score: number;
  needs_image: boolean;
};

type VisionPage = {
  page_number: number;
  mime: string;
  base64: string;
  text: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x4000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fileToVisionPage(file: File, text: string): Promise<VisionPage> {
  const pageNumber = Number(file.name.match(/page-(\d+)/i)?.[1] ?? 0);
  return file.arrayBuffer().then((buf) => ({
    page_number: pageNumber,
    mime: file.type || "image/jpeg",
    base64: bytesToBase64(new Uint8Array(buf)),
    text: text.slice(0, 8000),
  }));
}

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeItems(raw: unknown, pages: VisionPage[]): VisionExamItem[] {
  if (!Array.isArray(raw)) return [];
  const allowedPages = new Set(pages.map((p) => p.page_number));
  const items: VisionExamItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const kind = rec.kind === "frq" ? "frq" : rec.kind === "mcq" ? "mcq" : "";
    if (!kind) continue;
    const page = Number(rec.page_number);
    const page_number = allowedPages.has(page) ? page : pages[0]?.page_number ?? 1;
    const stem = clip(rec.stem, 2000);
    const content = clip(rec.content, 6000);
    const pageText = pages.find((p) => p.page_number === page_number)?.text ?? "";
    let visible = kind === "frq" ? studentVisibleQuestion(content || stem, pageText) : "";
    const fig = pageText.match(/fig(?:ure|\.)\s*\d+|图\s*\d+/i);
    if (kind === "frq" && visible.length < 8 && fig && (content || stem).length >= 20) {
      visible = `Refer to ${fig[0].replace(/\s+/g, " ")}.`;
    }
    const visibleStem = kind === "frq" ? studentVisibleQuestion(stem, pageText) : stem;
    const option_a = clip(rec.option_a, 500);
    const option_b = clip(rec.option_b, 500);
    const option_c = clip(rec.option_c, 500);
    const recovered = recoverOptionE(pageText, stem, clip(rec.option_d, 800), clip(rec.option_e, 500));
    const option_d = clip(recovered.option_d, 500);
    const option_e = clip(recovered.option_e, 500);
    if (kind === "mcq" && (!stem || !option_a || !option_b || !option_c || !option_d)) continue;
    if (kind === "frq" && visible.length < 8) continue;
    const answer = clip(rec.correct_answer, 8).toUpperCase();
    const blob = `${stem} ${content}`;
    const printed = readPrintedScore(blob, 0);
    const modelScore = Number(rec.max_score);
    const fromModel = Number.isFinite(modelScore) && modelScore >= 1 && modelScore <= 20 ? modelScore : 0;
    const modelNo = Number(rec.question_number);
    const printedNo = printedQuestionNumber(`${stem}\n${content}`);
    items.push({
      kind,
      sort_order: printedNo ?? (Number.isInteger(modelNo) && modelNo >= 1 && modelNo <= 80 ? modelNo : 0),
      page_number,
      stem: visibleStem || visible.slice(0, 180) || stem.slice(0, 180),
      option_a,
      option_b,
      option_c,
      option_d,
      option_e,
      correct_answer: kind === "mcq" && /^[A-E]$/.test(answer) ? answer : "",
      content: kind === "frq" ? visible : "",
      max_score: kind === "frq" ? officialFrqMax(`${stem}\n${content}`, fromModel > 0 && fromModel !== 9 ? fromModel : 0) : printed || fromModel || 1,
      needs_image: looksLikeProvidedFigure(blob),
    });
  }
  return withUniqueQuestionNumbers(items);
}

export async function visionParseExamPages(pages: VisionPage[]): Promise<{ items: VisionExamItem[]; error?: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { items: [], error: "AI 没有配置，没法按页图出题。" };
  if (pages.length === 0) return { items: [], error: "没有页图可以识别。" };

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "下面是一份老师上传的试卷，按页给出图片和提取到的文字。",
        "只抽出页面上真正印出的题目，不要编造，不要把说明、封面、答题卡说明当成题。",
        "选择题 kind=mcq，必须有题干，并且 A、B、C、D、E 都要原样抄下。卷面印了 E 时 option_e 不能空，也不要把 E 的文字并进 option_d。大题、简答、free-response 用 kind=frq。",
        "max_score 用卷面印出的分值。大题如果每个小问写了 (N points)，把各小问分值相加作为这道大题的满分。选择题没写分值就用 1。看不清分值时不要填 9。",
        "question_number 用卷面印的题号。选择题和大题如果连着编成 Q1、Q2、Q3、Q4，大题就要写成 3 和 4，不要把大题从 1 重新编号。",
        "页码用我标出的 page_number。看不清就不要猜那一题。",
        "大题的 content 和 stem 只抄卷面上印出来的句子。不要描述图，不要写曲线怎么走，不要写交点、均衡价格或数量。卷面如果只写了 Refer to Figure 1，就只保留这句。",
        ...pages.map((p) => `\n--- 第 ${p.page_number} 页文字 ---\n${p.text || "（这一页没有提取到文字）"}`),
      ].join("\n"),
    },
  ];
  for (const page of pages) {
    content.push({ type: "text", text: `第 ${page.page_number} 页图片` });
    content.push({
      type: "image_url",
      image_url: { url: `data:${page.mime};base64,${page.base64}` },
    });
  }

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "你从试卷页图里抽题。只输出工具要求的 JSON，不要解释。",
        },
        { role: "user", content },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_exam_items",
            description: "返回页面上真实存在的题目",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: ["mcq", "frq"] },
                      question_number: { type: "number" },
                      page_number: { type: "number" },
                      stem: { type: "string" },
                      option_a: { type: "string" },
                      option_b: { type: "string" },
                      option_c: { type: "string" },
                      option_d: { type: "string" },
                      option_e: { type: "string" },
                      correct_answer: { type: "string" },
                      content: { type: "string" },
                      max_score: { type: "number" },
                    },
                    required: ["kind", "page_number", "stem"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_exam_items" } },
    }),
  });
  if (r.status === 429) return { items: [], error: "AI 调用过于频繁，请稍后再传一次。" };
  if (r.status === 402) return { items: [], error: "AI 额度已用尽，这次没能按页图出题。" };
  if (!r.ok) {
    const t = await r.text();
    return { items: [], error: `AI 看页图失败（${r.status}）：${t.slice(0, 160)}` };
  }
  const j = await r.json();
  const argStr = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  let parsed: { items?: unknown } = {};
  try {
    parsed = argStr ? JSON.parse(argStr) : JSON.parse(String(j?.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, ""));
  } catch {
    return { items: [], error: "AI 没有返回可识别的题目。" };
  }
  const items = sanitizeItems(parsed.items, pages);
  if (items.length === 0) return { items, error: "AI 看完页图，没有认出完整题目。" };
  return { items };
}
