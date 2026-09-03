import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function stripLeftoverMarks(s: string) {
  return s.replace(/\*\*|__/g, "").replace(/`/g, "");
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re =
    /(\*\*\*[^*\n]+?\*\*\*|\*\*[^*\n]+?\*\*|__[^_\n]+?__|(?<!\*)\*(?!\*)[^*\n]+?\*(?!\*)|`[^`\n]+`)/g;
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(stripLeftoverMarks(text.slice(last, match.index)));
    const raw = match[0];
    if (raw.startsWith("***")) {
      parts.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold text-foreground">
          {raw.slice(3, -3)}
        </strong>,
      );
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      parts.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold text-foreground">
          {raw.slice(2, -2)}
        </strong>,
      );
    } else if (raw.startsWith("`")) {
      parts.push(
        <span key={`${keyPrefix}-c${i++}`} className="font-medium">
          {raw.slice(1, -1)}
        </span>,
      );
    } else {
      parts.push(
        <em key={`${keyPrefix}-i${i++}`} className="not-italic font-medium">
          {raw.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(stripLeftoverMarks(text.slice(last)));
  return parts;
}

function isListBlock(lines: string[]) {
  const items = lines.filter((line) => line.trim());
  if (items.length === 0) return false;
  return items.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line));
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (isListBlock(lines)) {
          const ordered = /^\s*\d+[.)]\s+/.test(lines.find((line) => line.trim()) ?? "");
          const List = ordered ? "ol" : "ul";
          return (
            <List
              key={bi}
              className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}
            >
              {lines
                .filter((line) => line.trim())
                .map((line, li) => (
                  <li key={li}>{inline(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${bi}-${li}`)}</li>
                ))}
            </List>
          );
        }
        const heading = lines.length === 1 ? block.match(/^#{1,3}\s+(.*)$/) : null;
        if (heading) {
          return (
            <p key={bi} className="font-semibold">
              {inline(heading[1], `${bi}`)}
            </p>
          );
        }
        return (
          <p key={bi}>
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(line.replace(/^#{1,3}\s+/, ""), `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
