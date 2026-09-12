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
  /graph provided|table provided|payoff matrix|shown in the graph|the graph shows|the graph provided|figure provided|combinations of donuts|based on the (table|graph|figure|payoff)|the table shows/i;

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
      needs_image: true,
    });
    from = start + String(n).length + 1;
  }
  return items;
}

export function parseApExamPages(pages: ExamPageText[]): ParsedExamItem[] {
  const marked = pages
    .map((p) => `<<<P${p.page_number}>>> ${p.extracted_text ?? ""}`)
    .join(" ");
  const { mcq, frq } = splitSection(marked);
  return [...parseMcqs(mcq), ...parseFrqs(frq)];
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
