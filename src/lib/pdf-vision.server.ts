import { acceptFrqRewrite, looksLikeProvidedFigure, officialFrqMax, printedQuestionNumber, readableFrqLabel, readPrintedScore, recoverOptionE, shapeOfficialFrq, studentVisibleQuestion, withUniqueQuestionNumbers } from "@/lib/ap-exam-parse";

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
    const content = kind === "frq" ? String(rec.content ?? "") : clip(rec.content, 6000);
    const pageText = pages.find((p) => p.page_number === page_number)?.text ?? "";
    let visible = kind === "frq" ? studentVisibleQuestion(content || stem, pageText) : "";
    const fig = pageText.match(/fig(?:ure|\.)\s*\d+|图\s*\d+/i);
    if (kind === "frq" && visible.length < 8 && fig && (content || stem).length >= 20) {
      visible = `Refer to ${fig[0].replace(/\s+/g, " ")}.`;
    }
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
    const sortOrder = printedNo ?? (Number.isInteger(modelNo) && modelNo >= 1 && modelNo <= 80 ? modelNo : 0);
    const visibleStem = kind === "frq" ? readableFrqLabel(studentVisibleQuestion(stem, pageText) || stem, visible, sortOrder || 1) : stem;
    items.push({
      kind,
      sort_order: sortOrder,
      page_number,
      stem: visibleStem || visible.slice(0, 180) || stem.slice(0, 180),
      option_a,
      option_b,
      option_c,
      option_d,
      option_e,
      correct_answer: kind === "mcq" && /^[A-E]$/.test(answer) ? answer : "",
      content: kind === "frq" ? shapeOfficialFrq(visible) : "",
      max_score: kind === "frq" ? officialFrqMax(`${stem}\n${content}`, fromModel > 0 && fromModel !== 9 ? fromModel : 0) : printed || fromModel || 1,
      needs_image: looksLikeProvidedFigure(`${blob}\n${visible}`),
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
        "页脚、页码、小红书水印、红书号可以忽略，不要写进题目，也不要因为有水印就丢掉这一页或这道题的图。",
        "先把图片里印出的题目文字原样抽进 stem 或 content。不要用 Markdown，不要加星号，不要加项目符号。",
        "如果这一页上有图表（坐标轴、曲线、表格），needs_image 设为 true。题图只要图表本身，不要把整页试卷当成题图。文字进题目，图表另裁。页面上没有印好的图表、只是让学生自己画图时，needs_image 设为 false。",
        "只抽出页面上真正印出的题目，不要编造，不要把说明、封面、答题卡说明当成题。",
        "选择题 kind=mcq。卷面是 A 到 E 五选一。option_a 到 option_e 都要原样抄下，option_e 不能空，也不要把 E 并进 option_d。E 经常在 D 的下一行或右栏。大题、简答、free-response 用 kind=frq。",
        "max_score 用卷面印出的分值。大题如果每个小问写了 (N points)，把各小问分值相加作为这道大题的满分。选择题没写分值就用 1。看不清分值时不要填 9。",
        "question_number 用卷面印的题号。选择题和大题如果连着编成 Q1、Q2、Q3、Q4，大题就要写成 3 和 4，不要把大题从 1 重新编号。",
        "页码用我标出的 page_number。看不清就不要猜那一题。",
        "大题的 content 严格照 2022 年 AP 微观卷的长度和分段。那三道大题刚刚好：一道大约 1100 到 1600 个字符，先一段题干，再写卷面上的 (a)(b)(c)…，小问用 i. ii. iii. 另起一行。不要翻译，不要加粗，不要项目符号，不要「写出计算过程」，不要评分说明，也不要把下一题或整页文字接进来。卷面上有几问就写到最后一问，不要写到 (a) 就跳到最后一问，也不要停在半个词上。",
        "下标和上标写成普通文字，不要 LaTeX。P 的下标 m 写成 P_m，P 的下标 f2 写成 P_f2。不要输出 \\mathrm、$、{ }。金额仍写 $12。",
        "印了表才放一个紧凑的 HTML 表格，和 2022 年第 3 题一样。题干写 table above、diagram above、上表、上图时，把这道题上方的表或图里印出的文字一并放进 content，不要丢掉。不要描述图，不要写曲线怎么走，不要写交点、均衡价格或数量。卷面如果只写了 Refer to Figure 1，就只保留这句。",
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

function keepPrintedQuestion(text: string, sort: number) {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/^(directions|planning time|writing time|section ii|microeconomics|go on to the next page|visit the college board)/i.test(t)) return false;
    if (/©|college board|form b|free-response questions/i.test(t) && t.length < 90) return false;
    if (/^-\d+-$/.test(t)) return false;
    return true;
  });
  let body = lines.join("\n").trim();
  const next = body.search(new RegExp(`\\n\\s*${sort + 1}\\.\\s+[A-Z]`));
  if (next > 200) body = body.slice(0, next).trim();
  return body;
}

/** Rewrite one short or garbled FRQ from its page image. Returns "" when the page cannot be read. */
export async function rewriteFrqFromPage(input: {
  imageUrl: string;
  content: string;
  sort: number;
  stem: string;
}): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || !input.imageUrl.startsWith("https://")) return "";
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "你按试卷页图重写一道已经被切短或符号写坏的大题。只输出工具要求的 JSON。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `只重写第 ${input.sort} 题。以页图为准，残稿只用来认出是哪一题。`,
                "从题干写到最后一个小问。卷面上有 (a)(b)(c)(d)(e) 就都要在，不要从 (a) 跳到最后一问，也不要停在半个词上。",
                "下标写成普通文字：P 的下标 f 写成 P_f，P 的下标 f2 写成 P_f2，P 的下标 m 写成 P_m。不要 LaTeX，不要 \\mathrm，不要 $ { }。金额仍写 $12。",
                "不要翻译，不要加粗，不要项目符号，不要 Directions、页脚、评分说明，也不要把下一题写进来。",
                "小问 (a)(b)(c) 另起一段，i. ii. iii. 另起一行。",
                `残稿：\n${input.content.slice(0, 1200) || input.stem.slice(0, 240)}`,
              ].join("\n"),
            },
            { type: "image_url", image_url: { url: input.imageUrl } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "rewrite_frq",
            description: "返回这一道大题印出的全文",
            parameters: {
              type: "object",
              properties: { content: { type: "string" } },
              required: ["content"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "rewrite_frq" } },
    }),
  });
  if (!r.ok) return "";
  const j = await r.json().catch(() => null);
  const argStr = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  let content = "";
  try {
    const parsed = argStr ? JSON.parse(argStr) : {};
    content = String(parsed.content ?? "");
  } catch {
    content = "";
  }
  const kept = keepPrintedQuestion(content, input.sort);
  return acceptFrqRewrite(input.content, kept);
}
