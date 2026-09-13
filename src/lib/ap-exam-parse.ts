/** Hard-coded AP Micro PDF splitter: text + page images, no vision model. */

export type ExamPageText = {
  page_number: number;
  extracted_text: string;
};

export type ParsedExamItem = {
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

const IMAGE_HINT =
  /graph provided|table provided|payoff matrix|shown in the graph|the graph shows|the graph provided|figure provided|combinations of donuts|based on the (table|graph|figure|payoff)|the table shows|refer to the (graph|table|figure)|the figure shows|diagram provided|见(上|下)?(图|表)|如图|如表|下图|下表|上图|上表|图示|示意图/i;

/** True when the stem/content refers to a printed table/graph, not “draw a graph”. */
export function looksLikeProvidedFigure(text: string) {
  return IMAGE_HINT.test(text);
}

function clean(s: string) {
  return s
    .replace(/\u00ad/g, "")
    .replace(/<<<P\d+>>>/g, " ")
    .replace(/(\w)-\s+(\w)/g, "$1$2")
    .replace(/\bSTOP END OF SECTION I\b/gi, "")
    .replace(/\s+(?:Capital Labor|Output AFC|Number of Workers)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pageOf(marked: string, index: number) {
  const slice = marked.slice(0, index);
  const matches = [...slice.matchAll(/<<<P(\d+)>>>/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : 1;
}

function splitSection(marked: string) {
  const m = marked.search(/SECTION II|Section II|Free-Response Questions/i);
  if (m < 0) return { mcq: marked, frq: "" };
  return { mcq: marked.slice(0, m), frq: marked.slice(m) };
}

function findExpected(text: string, n: number, from: number) {
  const re = new RegExp(`(?:^|\\s)(${n}\\.\\s)`);
  const m = re.exec(text.slice(from));
  if (!m || m.index === undefined) return -1;
  return from + m.index + m[0].length - m[1].length;
}

function parseOptions(body: string) {
  const hits = [...body.matchAll(/\(([A-E])\)\s*/g)];
  if (hits.length < 4) return null;
  const stem = clean(body.slice(0, hits[0].index));
  const opts: Record<string, string> = {};
  hits.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : body.length;
    opts[h[1]] = clean(body.slice(start, end));
  });
  return { stem, opts };
}

function parseMcqs(mcqText: string): ParsedExamItem[] {
  const items: ParsedExamItem[] = [];
  let from = 0;
  let carry = "";
  let sharedFrom = 0;
  let sharedUntil = 0;
  for (let n = 1; n <= 60; n++) {
    const start = findExpected(mcqText, n, from);
    if (start < 0) break;
    const next = findExpected(mcqText, n + 1, start + String(n).length + 1);
    const end = next < 0 ? mcqText.length : next;
    let chunk = mcqText.slice(start + String(n).length + 1, end);
    const prefix = carry;
    carry = "";
    const shared = chunk.match(/\s+Questions?\s+\d+[-–]\d+[\s\S]*$/i);
    if (shared) {
      carry = clean(shared[0]);
      chunk = chunk.slice(0, shared.index);
    }
    const parsed = parseOptions(chunk);
    from = start + String(n).length + 1;
    if (!parsed) continue;
    const lastKey = ["E", "D", "C", "B", "A"].find((k) => parsed.opts[k]);
    if (lastKey) {
      const leak = parsed.opts[lastKey].search(/\s+Questions?\s+\d+[-–]\d+/i);
      if (leak >= 0) {
        carry = clean(`${parsed.opts[lastKey].slice(leak)} ${carry}`);
        parsed.opts[lastKey] = clean(parsed.opts[lastKey].slice(0, leak));
      }
      parsed.opts[lastKey] = parsed.opts[lastKey]
        .replace(/^(\$[\d,]+(?:\.\d+)?)(?:\s+\d+)+$/, "$1")
        .replace(/(?:\s+\d+){2,}$/, "");
      if (parsed.opts[lastKey].split(" ").length > 6 && !/^\$?[\d,]+/.test(parsed.opts[lastKey])) {
        parsed.opts[lastKey] = parsed.opts[lastKey].replace(/\s+\d+$/, "");
      }
    }
    const page_number = pageOf(mcqText, start);
    const stem = clean([prefix, parsed.stem].filter(Boolean).join(" "));
    const blob = `${stem} ${Object.values(parsed.opts).join(" ")}`;
    const range = `${prefix} ${carry} ${stem}`.match(/Questions?\s+(\d+)[-–](\d+)/i);
    if (range) {
      sharedFrom = Number(range[1]);
      sharedUntil = Number(range[2]);
    }
    items.push({
      kind: "mcq",
      sort_order: n,
      page_number,
      stem,
      option_a: parsed.opts.A ?? "",
      option_b: parsed.opts.B ?? "",
      option_c: parsed.opts.C ?? "",
      option_d: parsed.opts.D ?? "",
      option_e: parsed.opts.E ?? "",
      correct_answer: "",
      content: "",
      max_score: 1,
      needs_image: IMAGE_HINT.test(blob) || (n >= sharedFrom && n <= sharedUntil),
    });
  }
  return items;
}

function parseFrqs(frqText: string): ParsedExamItem[] {
  if (!frqText.trim()) return [];
  const items: ParsedExamItem[] = [];
  let from = 0;
  for (let n = 1; n <= 6; n++) {
    const start = findExpected(frqText, n, from);
    if (start < 0) break;
    const next = findExpected(frqText, n + 1, start + String(n).length + 1);
    const end = next < 0 ? frqText.length : next;
    const content = clean(frqText.slice(start + String(n).length + 1, end));
    if (content.length < 40) {
      from = start + String(n).length + 1;
      continue;
    }
    const page_number = pageOf(frqText, start);
    const stem = content.slice(0, 180);
    items.push({
      kind: "frq",
      sort_order: n,
      page_number,
      stem,
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      option_e: "",
      correct_answer: "",
      content,
      max_score: n === 1 ? 10 : 5,
      needs_image: IMAGE_HINT.test(content),
    });
    from = start + String(n).length + 1;
  }
  return items;
}

export function parseAnswerKey(text: string): Record<number, string> {
  const hit = text.search(/answer\s*key|scoring\s+worksheet|answers?\s+to\s+(the\s+)?(section|multiple)|参考答案|正确答案|答案速查/i);
  if (hit < 0) return {};
  const slice = text.slice(hit, hit + 5000);
  const out: Record<number, string> = {};
  const re = /(?:^|[^\d])(\d{1,2})\s*[.．)、:\-]\s*\(?([A-Ea-e])\)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 60 && !out[n]) out[n] = m[2].toUpperCase();
  }
  return out;
}

/** Official 2022 AP Micro Section I key. The public exam PDF has no answer sheet. */
export const AP_MICRO_2022_MCQ_KEY: Record<number, string> = {
  1: "C", 2: "D", 3: "A", 4: "C", 5: "B", 6: "C", 7: "B", 8: "A", 9: "C", 10: "C",
  11: "D", 12: "B", 13: "D", 14: "D", 15: "C", 16: "B", 17: "D", 18: "A", 19: "B", 20: "D",
  21: "B", 22: "D", 23: "A", 24: "C", 25: "C", 26: "B", 27: "E", 28: "C", 29: "B", 30: "C",
  31: "B", 32: "C", 33: "E", 34: "E", 35: "D", 36: "A", 37: "C", 38: "E", 39: "D", 40: "B",
  41: "A", 42: "C", 43: "C", 44: "A", 45: "A", 46: "A", 47: "B", 48: "B", 49: "D", 50: "C",
  51: "B", 52: "D", 53: "E", 54: "B", 55: "D", 56: "D", 57: "D", 58: "D", 59: "B", 60: "D",
};

/** MCQs that share a graph/table page on the 2022 paper (same set as the 2025-style page images). */
export const AP_MICRO_2022_IMAGE_MCQS = new Set([7, 8, 9, 17, 24, 28, 29, 31, 36, 40, 42, 43, 50, 58]);

export function applyKnownApAnswerKey<T extends { kind: string; sort_order: number; correct_answer: string; needs_image?: boolean }>(
  items: T[],
  filenameOrTitle: string,
) {
  if (!/2022/.test(filenameOrTitle)) return items;
  for (const it of items) {
    if (it.kind === "mcq" && !it.correct_answer && AP_MICRO_2022_MCQ_KEY[it.sort_order]) {
      it.correct_answer = AP_MICRO_2022_MCQ_KEY[it.sort_order];
    }
    if (it.kind === "mcq" && AP_MICRO_2022_IMAGE_MCQS.has(it.sort_order)) it.needs_image = true;
  }
  return items;
}

export function parseApExamPages(pages: ExamPageText[]): ParsedExamItem[] {
  const marked = pages
    .map((p) => `<<<P${p.page_number}>>> ${p.extracted_text ?? ""}`)
    .join(" ");
  const { mcq, frq } = splitSection(marked);
  const items = [...parseMcqs(mcq), ...parseFrqs(frq)];
  const keys = parseAnswerKey(marked);
  const filled = Object.keys(keys).length;
  if (filled >= 3) {
    for (const it of items) {
      if (it.kind === "mcq" && keys[it.sort_order]) it.correct_answer = keys[it.sort_order];
    }
  }
  return items;
}

export function examSlugFromFilename(filename: string) {
  const year = filename.match(/20\d{2}/)?.[0];
  if (year) return `ap-micro-${year}`;
  const slug = filename
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `ap-micro-${Date.now().toString(36)}`;
}
