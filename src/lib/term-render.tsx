import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export type TermInfo = { term_en: string; term_zh: string; definition: string };

/**
 * 在英文题干中给术语加下划线 + hover 中英对照气泡。
 * 通过题目的 term_tags 列表 + 全局术语字典进行字符串匹配，区分大小写不敏感。
 */
export function renderStemWithTerms(
  text: string,
  tags: string[],
  dict: Record<string, TermInfo>,
): React.ReactNode {
  if (!text) return null;
  // 收集存在于词典中的术语
  const terms = tags
    .map((t) => dict[t.toLowerCase()])
    .filter(Boolean)
    .sort((a, b) => b.term_en.length - a.term_en.length); // 长词优先
  if (terms.length === 0) return text;

  const pattern = new RegExp(
    `\\b(${terms.map((t) => t.term_en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "gi",
  );
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const matched = m[0];
    const info = dict[matched.toLowerCase()] ?? terms.find((t) => t.term_en.toLowerCase() === matched.toLowerCase());
    if (info) {
      parts.push(<TermPopover key={key++} text={matched} info={info} />);
    } else {
      parts.push(matched);
    }
    last = m.index + matched.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function TermPopover({ text, info }: { text: string; info: TermInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard openDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <span
          onClick={() => setOpen((v) => !v)}
          className="cursor-help underline decoration-dotted decoration-primary/70 underline-offset-4 text-foreground/90 hover:text-primary"
        >
          {text}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-foreground">{info.term_en}</span>
            <span className="text-sm text-primary">{info.term_zh}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{info.definition}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}