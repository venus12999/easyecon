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
  const re = /(选项\s*[ABCDE]|答案\s*[ABCDE]|Option\s*[ABCDE]|\([ABCDE]\)|([ABCDE])|「[ABCDE]」|【[ABCDE]】|\b[ABCDE]\s*选项)/g;
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