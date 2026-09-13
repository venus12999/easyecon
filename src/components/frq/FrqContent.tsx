import { Fragment } from "react";

// Renders FRQ content, converting embedded <table>...</table> HTML markup
// into real tables. All other tags are stripped so raw HTML never leaks to
// the user as "乱码". Nothing else is rendered as HTML.

type Cell = { tag: "th" | "td"; text: string };
type Row = Cell[];

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/[ \t]+\n/g, "\n").trim();
}

/** Skip the 180-char stem dump so the heading stays “Question 1”, not the whole prompt. */
export function shortFrqTitle(title: string | null | undefined, content: string) {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const c = (content ?? "").replace(/\s+/g, " ").trim();
  if (t.length > 72) return "";
  if (c.startsWith(t.slice(0, Math.min(32, t.length)))) return "";
  return t;
}

type FrqSub = { label: string; body: string };
type FrqPart = { label: string; body: string; subs: FrqSub[] };

function tidyChunk(s: string) {
  return s.replace(/^[-*]\s+/, "").replace(/\s*[-*]\s*$/, "").trim();
}

function splitSubs(chunk: string): { body: string; subs: FrqSub[] } {
  const subRe = /\((iv|iii|ii|i)\)\s+|\b(iv|iii|ii|i)\.\s+/gi;
  const hits = [...chunk.matchAll(subRe)];
  if (hits.length === 0) return { body: tidyChunk(chunk), subs: [] };
  const first = hits[0].index ?? 0;
  const body = tidyChunk(chunk.slice(0, first));
  const subs = hits.map((hit, i) => {
    const start = (hit.index ?? 0) + hit[0].length;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? chunk.length) : chunk.length;
    const roman = (hit[1] || hit[2] || "i").toLowerCase();
    return {
      label: hit[1] ? `(${roman})` : `${roman}.`,
      body: tidyChunk(chunk.slice(start, end)),
    };
  });
  return { body, subs: subs.filter((s) => s.body) };
}

function splitFrqPrompt(text: string): { intro: string; parts: FrqPart[] } {
  const normalized = text
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\.\s+(\d{1,2})$/, ".")
    .trim();
  // Teacher PDFs collapse (a)/(b) into one paragraph. Skip later "(a)" references
  // like "in part (a)" or "drawn in (a).", and ignore roman (i) as a lettered part.
  const partRe = /\*{0,2}[\(（]([a-h])[\)）]\*{0,2}\s+/gi;
  const allHits = [...normalized.matchAll(partRe)];
  const expected = "abcdefgh";
  const hits: RegExpMatchArray[] = [];
  let next = 0;
  for (const hit of allHits) {
    const letter = hit[1].toLowerCase();
    if (letter === expected[next]) {
      hits.push(hit);
      next += 1;
    }
  }
  if (hits.length === 0) return { intro: normalized, parts: [] };
  const intro = tidyChunk(normalized.slice(0, hits[0].index ?? 0));
  const parts = hits.map((hit, i) => {
    const start = (hit.index ?? 0) + hit[0].length;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? normalized.length) : normalized.length;
    const { body, subs } = splitSubs(tidyChunk(normalized.slice(start, end)));
    return { label: `(${hit[1].toLowerCase()})`, body, subs };
  });
  return { intro, parts };
}

function parseTable(html: string): Row[] {
  const rows: Row[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html))) {
    const cells: Row = [];
    const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      cells.push({
        tag: cm[1].toLowerCase() as "th" | "td",
        text: stripTags(cm[2]),
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function FrqContent({ content, className }: { content: string; className?: string }) {
  const parts: { type: "text" | "table"; value: string; rows?: Row[] }[] = [];
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(content))) {
    if (m.index > last) parts.push({ type: "text", value: content.slice(last, m.index) });
    parts.push({ type: "table", value: m[0], rows: parseTable(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", value: content.slice(last) });

  return (
    <div className={className}>
      {parts.map((p, i) => {
        if (p.type === "text") {
          const text = stripTags(p.value);
          if (!text) return null;
          const { intro, parts } = splitFrqPrompt(text);
          if (parts.length === 0) {
            return (
              <p key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
                {text}
              </p>
            );
          }
          return (
            <div key={i} className="text-sm leading-relaxed space-y-3">
              {intro ? <p>{intro}</p> : null}
              {parts.map((part) => (
                <div key={part.label} className="space-y-1.5">
                  <p>
                    <span className="font-semibold">{part.label}</span>
                    {part.body ? ` ${part.body}` : ""}
                  </p>
                  {part.subs.map((sub) => (
                    <p key={sub.label} className="pl-4">
                      <span className="font-medium">{sub.label}</span> {sub.body}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          );
        }
        const rows = p.rows ?? [];
        if (!rows.length) return null;
        return (
          <div key={i} className="my-3 overflow-x-auto">
            <table className="border-collapse border border-border text-sm">
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <Fragment key={ci}>
                        {c.tag === "th" ? (
                          <th className="border border-border bg-muted px-3 py-1.5 font-semibold text-left">
                            {c.text}
                          </th>
                        ) : (
                          <td className="border border-border px-3 py-1.5">{c.text}</td>
                        )}
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}