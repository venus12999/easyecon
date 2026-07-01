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
          return (
            <p key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
              {text}
            </p>
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