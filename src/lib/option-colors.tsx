import type { ReactNode } from "react";

export type OptKey = "A" | "B" | "C" | "D" | "E";

export const OPTION_KEYS: OptKey[] = ["A", "B", "C", "D", "E"];

// Inline style maps so values come straight from CSS tokens defined in src/styles.css.
// Using inline style avoids generating dynamic class strings that Tailwind cannot statically detect.
export const optionStyles: Record<OptKey, { bg: string; bgSoft: string; ink: string; border: string }> = {
  A: { bg: "var(--opt-a)", bgSoft: "var(--opt-a-soft)", ink: "var(--opt-a-ink)", border: "var(--opt-a)" },
  B: { bg: "var(--opt-b)", bgSoft: "var(--opt-b-soft)", ink: "var(--opt-b-ink)", border: "var(--opt-b)" },
  C: { bg: "var(--opt-c)", bgSoft: "var(--opt-c-soft)", ink: "var(--opt-c-ink)", border: "var(--opt-c)" },
  D: { bg: "var(--opt-d)", bgSoft: "var(--opt-d-soft)", ink: "var(--opt-d-ink)", border: "var(--opt-d)" },
  E: { bg: "var(--opt-e)", bgSoft: "var(--opt-e-soft)", ink: "var(--opt-e-ink)", border: "var(--opt-e)" },
};

/**
 * Color any reference to an option (A/B/C/D, "选项 A", "Option B", "(C)" etc.) inside an explanation
 * with the matching option color so students can immediately tie the analysis to the option chip.
 */
export function colorizeExplanation(text: string): ReactNode[] {
  if (!text) return [];

  // 1) 如果解析按 A./B./C... 分段解释每个选项，则每段整体着色
  const segRe = /(^|\n)\s*(?:选项\s*)?([ABCDE])\s*[\.、:：\)）]\s*/g;
  const segMatches: { letter: OptKey; start: number; contentStart: number }[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = segRe.exec(text)) !== null) {
    segMatches.push({
      letter: sm[2] as OptKey,
      start: sm.index + sm[1].length,
      contentStart: sm.index + sm[0].length,
    });
  }
  const distinctLetters = new Set(segMatches.map((s) => s.letter));
  if (segMatches.length >= 2 && distinctLetters.size >= 2) {
    const parts: ReactNode[] = [];
    if (segMatches[0].start > 0) parts.push(text.slice(0, segMatches[0].start));
    for (let i = 0; i < segMatches.length; i++) {
      const cur = segMatches[i];
      const end = i + 1 < segMatches.length ? segMatches[i + 1].start : text.length;
      const seg = text.slice(cur.start, end);
      const s = optionStyles[cur.letter];
      parts.push(
        <span
          key={`seg-${i}`}
          className="block rounded px-2 py-1 my-1"
          style={{ color: s.ink, background: s.bgSoft, borderLeft: `3px solid ${s.bg}` }}
        >
          {seg}
        </span>,
      );
    }
    return parts;
  }

  // 2) 否则只对明确指代选项的写法着色（避免命中 MC、AP、E 等普通字母）
  const re = /(选项\s*[ABCDE]|答案\s*[ABCDE]|Option\s+[ABCDE]|\([ABCDE]\)|（[ABCDE]）|「[ABCDE]」|【[ABCDE]】|[ABCDE]\s*选项)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const letter = (m[0].match(/[ABCDE]/)![0]) as OptKey;
    parts.push(
      <span
        key={`opt-${key++}`}
        className="font-semibold rounded px-1"
        style={{ color: optionStyles[letter].ink, background: optionStyles[letter].bgSoft }}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}