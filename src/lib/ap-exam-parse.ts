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
  /graph provided|table provided|payoff matrix|shown in the graph|the graph shows|the graph provided|figure provided|figure\s*\d|combinations of donuts|based on the (table|graph|figure|payoff)|the table shows|refer to the (graph|table|figure)|the figure shows|diagram provided|diagram above|diagram below|the diagram|in the diagram|graph above|graph below|graph of|table above|table below|the table above|the table below|shown above|shown below|见(上|下)?(图|表)|如图|如表|下图|下表|上图|上表|图示|示意图|图\s*\d/i;

/** Read a printed point value. Part marks like "(2 points)" are added up. */
export function readPrintedScore(text: string, fallback: number) {
  const parts = [...text.matchAll(/\((\d{1,2})\s*points?\)/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 15);
  if (parts.length > 0) {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum >= 1 && sum <= 20) return sum;
  }
  const loose = text.match(/\b(\d{1,2})\s*points?\b/i) ?? text.match(/(?:满分|共)\s*(\d{1,2})\s*分/);
  if (loose) {
    const n = Number(loose[1]);
    if (n >= 1 && n <= 20) return n;
  }
  return fallback;
}

/** Use the points printed on the question. A stored 9 is the column default, not a printed score. */
export function officialFrqMax(text: string, stored: number | null | undefined) {
  const printed = readPrintedScore(text, 0);
  const column = typeof stored === "number" && stored >= 1 && stored <= 20 ? Math.round(stored) : 0;
  if (printed >= 1 && printed <= 20 && (column === 0 || (column === 9 && printed !== 9))) return printed;
  return column || printed;
}

/** Pull a trailing "(E) ..." out of option D when the cutter glued the last choice on. */
export function splitTrailingChoiceE(optionD: string, optionE: string) {
  const e = optionE.trim();
  if (e) return { option_d: optionD.trim(), option_e: e };
  const match = optionD.match(/^(.*\S)\s+(?:\(E\)|E[.)])\s+(\S[\s\S]*)$/i);
  if (!match?.[1]?.trim() || !match[2]?.trim()) return { option_d: optionD.trim(), option_e: "" };
  return { option_d: match[1].trim(), option_e: match[2].trim() };
}

function choiceWindow(pageText: string, stem: string, optionD: string) {
  const page = pageText;
  const d = optionD.replace(/\s+/g, " ").trim();
  const s = stem.replace(/\s+/g, " ").trim();
  const anchors = [d.slice(0, 40), s.slice(0, 24), s.slice(0, 40)].filter((value) => value.length >= 8);
  for (const anchor of anchors) {
    const at = page.toLowerCase().indexOf(anchor.toLowerCase());
    if (at < 0) continue;
    return page.slice(at, at + 1600)
      .replace(/（\s*([A-E])\s*）/g, "($1) ")
      .replace(/\(\s*([A-E])\s*\)/g, "($1) ")
      .replace(/(^|[\s])([A-E])\s*[.)、．)]\s+/g, "$1($2) ");
  }
  return "";
}

function optionEText(window: string) {
  const match = window.match(/\(E\)\s*([\s\S]*?)(?=\(\s*[A-D]\s*\)|\n\s*\d{1,2}\s*[.)、．]|$)/i)
    ?? window.match(/(?:^|\n)\s*E[.)、．]\s+([\s\S]*?)(?=\n\s*[A-D][.)、．]|\n\s*\d{1,2}\s*[.)、．]|$)/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

/** Fill a missing E from the page text after D or the stem, or from a choice glued onto D. */
export function recoverOptionE(pageText: string, stem: string, optionD: string, optionE: string) {
  const split = splitTrailingChoiceE(optionD, optionE);
  if (split.option_e) return split;
  if (!pageText.trim()) return split;
  const text = optionEText(choiceWindow(pageText, stem, split.option_d));
  if (!text || text.length > 500) return split;
  return { option_d: split.option_d, option_e: text };
}

export function fillOptionEFrom<T extends { kind: string; sort_order: number; stem?: string | null; option_e?: string | null }>(base: T[], extra: T[]): T[] {
  return base.map((item) => {
    if (item.kind !== "mcq" || (item.option_e ?? "").trim()) return item;
    const stem = (item.stem ?? "").replace(/\s+/g, " ").trim().slice(0, 32).toLowerCase();
    const hit = extra.find((other) => {
      if (other.kind !== "mcq" || !(other.option_e ?? "").trim()) return false;
      const otherStem = (other.stem ?? "").replace(/\s+/g, " ").trim().slice(0, 32).toLowerCase();
      return other.sort_order === item.sort_order || (stem.length >= 12 && stem === otherStem);
    });
    return hit ? { ...item, option_e: hit.option_e ?? item.option_e } : item;
  });
}

/** A bare "9" is a printed number, not the question title. */
export function readableFrqLabel(stem: string, content: string, sort: number) {
  const raw = stem.replace(/\s+/g, " ").trim();
  const bare = !raw || /^\d{1,2}[.)、]?$/.test(raw) || raw.length < 8;
  const source = (bare ? content : raw).replace(/\s+/g, " ").trim().replace(/^\d{1,2}\s*[.、.)]\s*/, "");
  if (source.length < 8) return `第 ${sort} 题`;
  return source.slice(0, 160);
}

/** Printed question number at the start of a stem, such as "Question 3" or "3." */
export function printedQuestionNumber(text: string): number | null {
  const head = text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!head) return null;
  const match = head.match(/^(?:question|q)\s*\.?\s*(\d{1,2})\b/i)
    ?? head.match(/^第\s*(\d{1,2})\s*题/)
    ?? head.match(/^(\d{1,2})\s*[.、.)]/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 80 ? n : null;
}

/** Keep each question's printed number. Numbers stay unique within the same kind. */
export function withUniqueQuestionNumbers<T extends { kind?: string; sort_order: number; stem?: string | null; content?: string | null; title?: string | null }>(items: T[]): T[] {
  const used = new Map<string, Set<number>>();
  const seen = new Map<string, number>();
  return items.map((item) => {
    const kind = item.kind ?? "item";
    const taken = used.get(kind) ?? new Set<number>();
    used.set(kind, taken);
    const printed = printedQuestionNumber(`${item.title ?? ""}\n${item.stem ?? ""}\n${item.content ?? ""}`);
    const next = (seen.get(kind) ?? 0) + 1;
    let n = printed ?? (item.sort_order >= 1 ? item.sort_order : next);
    while (taken.has(n)) n += 1;
    taken.add(n);
    seen.set(kind, n);
    return n === item.sort_order ? item : { ...item, sort_order: n };
  });
}

/** True when the stem/content refers to a printed table/graph, not “draw a graph”. */
export function looksLikeProvidedFigure(text: string) {
  return IMAGE_HINT.test(text);
}

const FIGURE_GIVEAWAY =
  /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)|(?:curves?\s+)?(?:intersect|cross|meet)s?(?:\s+\w+){0,4}\s+at\b|(?:the\s+)?(?:graph|figure|diagram)\s+(?:shows|depicts|illustrates|has|indicates)\b|equilibrium\s+(?:price|quantity|point)\s+(?:is|of|at|equals)\s+[$]?\d|交点|相交|交于|均衡(?:点|价格|数量)(?:是|为|在)\s*\d/i;

function compact(text: string) {
  return text.toLowerCase().replace(/[‐-−]/g, "").replace(/[^a-z0-9\u4e00-\u9fff()]+/g, "");
}

function printedSentence(sentence: string, page: string) {
  const n = compact(sentence);
  if (!page || n.length < 16) return false;
  const head = n.slice(0, Math.min(40, n.length));
  const tail = n.slice(Math.max(0, n.length - 40));
  return page.includes(head) || page.includes(tail);
}

/** Drop a model-written graph description. Printed question sentences stay. */
export function studentVisibleQuestion(text: string, pageText = "") {
  const page = compact(pageText);
  const caption = /^(?:[•·●▪‣*\-]\s*)?(?:graph|figure|diagram|table)\s+of\b/i;
  const kept = text
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !caption.test(s))
    .filter((s) => !FIGURE_GIVEAWAY.test(s) || printedSentence(s, page));
  return kept.join("\n").replace(/[ \t]+\n/g, "\n").trim();
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

function choiceRun(hits: { letter: string; index: number; end: number }[]) {
  let best: typeof hits | null = null;
  const order = ["A", "B", "C", "D", "E"];
  for (let start = 0; start < hits.length; start += 1) {
    if (hits[start]?.letter !== "A") continue;
    const run = [hits[start]];
    let next = 1;
    for (let i = start + 1; i < hits.length && next < order.length; i += 1) {
      if (hits[i]?.letter !== order[next]) continue;
      run.push(hits[i]);
      next += 1;
    }
    if (run.length >= 4) best = run;
  }
  return best;
}

function parseOptions(body: string) {
  const normalized = body
    .replace(/（\s*([A-E])\s*）/gi, "($1)")
    .replace(/\(\s*([A-E])\s*\)/gi, "($1)");
  const hits: { letter: string; index: number; end: number }[] = [];
  for (const match of normalized.matchAll(/(?:^|\s)(?:\(([A-E])\)|([A-E])\s*[.)、．)])(?=\s|$)/gi)) {
    const letter = (match[1] || match[2] || "").toUpperCase();
    if (!letter || match.index === undefined) continue;
    hits.push({ letter, index: match.index, end: match.index + match[0].length });
  }
  const run = choiceRun(hits);
  if (!run) return null;
  const stem = clean(normalized.slice(0, run[0].index));
  const opts: Record<string, string> = {};
  run.forEach((hit, i) => {
    const end = i + 1 < run.length ? run[i + 1].index : normalized.length;
    opts[hit.letter] = clean(normalized.slice(hit.end, end));
  });
  if (!opts.A || !opts.B || !opts.C || !opts.D) return null;
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
    const splitChoices = splitTrailingChoiceE(parsed.opts.D ?? "", parsed.opts.E ?? "");
    parsed.opts.D = splitChoices.option_d;
    parsed.opts.E = splitChoices.option_e;
    if (!parsed.opts.E) {
      const recovered = recoverOptionE(chunk, parsed.stem, parsed.opts.D, "");
      if (recovered.option_e) {
        parsed.opts.D = recovered.option_d;
        parsed.opts.E = recovered.option_e;
      }
    }
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
      max_score: readPrintedScore(blob, 1),
      needs_image: IMAGE_HINT.test(blob) || (n >= sharedFrom && n <= sharedUntil),
    });
  }
  return items;
}

function cleanFrq(s: string) {
  return s
    .replace(/\u00ad/g, "")
    .replace(/<<<P\d+>>>/g, "\n")
    .replace(/\bSTOP END OF SECTION II\b/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The table or diagram printed above a question, kept with the question that refers to it. */
function stimulusTail(previous: string) {
  const lines = previous.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < 16; i -= 1) {
    const line = lines[i] ?? "";
    if (/^\([a-e]\)/i.test(line)) break;
    if (tail.length > 0 && line.length > 80 && !/\d/.test(line)) break;
    tail.unshift(line);
  }
  const block = tail.join("\n");
  const numbers = (block.match(/\d+/g) ?? []).length;
  if (tail.length >= 3 && (numbers >= 4 || /table|figure|diagram|graph|价格|数量|工人/i.test(block))) return block;
  return "";
}

function parseFrqs(frqText: string): ParsedExamItem[] {
  if (!frqText.trim()) return [];
  const items: ParsedExamItem[] = [];
  let from = 0;
  const firstStart = findExpected(frqText, 1, 0);
  let previousRaw = firstStart > 0 ? frqText.slice(0, firstStart) : "";
  for (let n = 1; n <= 6; n++) {
    const start = findExpected(frqText, n, from);
    if (start < 0) break;
    const next = findExpected(frqText, n + 1, start + String(n).length + 1);
    const end = next < 0 ? frqText.length : next;
    const raw = frqText.slice(start + String(n).length + 1, end);
    let content = cleanFrq(raw);
    if (/above|上表|上图|如上/i.test(content)) {
      const stim = stimulusTail(previousRaw);
      if (stim && !content.includes(stim.slice(0, 24))) content = `${stim}\n${content}`;
    }
    previousRaw = raw;
    if (content.length < 40) {
      from = start + String(n).length + 1;
      continue;
    }
    const page_number = pageOf(frqText, start);
    const stem = content.replace(/\s+/g, " ").slice(0, 180);
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
      max_score: readPrintedScore(content, 0),
      needs_image: looksLikeProvidedFigure(content),
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
  const pageText = new Map(pages.map((page) => [page.page_number, page.extracted_text ?? ""]));
  return items.map((item) => {
    if (item.kind !== "mcq" || item.option_e.trim()) return item;
    const recovered = recoverOptionE(pageText.get(item.page_number) ?? "", item.stem, item.option_d, item.option_e);
    return recovered.option_e ? { ...item, option_d: recovered.option_d, option_e: recovered.option_e } : item;
  });
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
