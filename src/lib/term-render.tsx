import { isValidElement, cloneElement, type ReactNode } from "react";

/**
 * 在已经被其他工具加工过的 ReactNode 树中（例如 colorizeExplanation 的输出）
 * 对所有字符串子节点再叠加术语高亮。
 */
export function highlightTermsInNodes(nodes: ReactNode, dict: TermDict): ReactNode {
  if (nodes == null || typeof nodes === "boolean") return nodes;
  if (typeof nodes === "string") return renderWithTerms(nodes, dict);
  if (typeof nodes === "number") return nodes;
  if (Array.isArray(nodes)) {
    return nodes.map((n, i) => <Wrap key={i}>{highlightTermsInNodes(n, dict)}</Wrap>);
  }
  if (isValidElement(nodes)) {
    const el = nodes as React.ReactElement<{ children?: ReactNode }>;
    const children = el.props?.children;
    if (children === undefined) return el;
    return cloneElement(el, undefined, highlightTermsInNodes(children, dict));
  }
  return nodes;
}

function Wrap({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type TermInfo = {
  term_en: string;
  term_zh: string;
  definition: string;
  confusable_with?: string[] | null;
};

export type TermDict = Record<string, TermInfo>;

/**
 * 将文本中所有出现在术语词典里的英文术语高亮，点击弹出双语 + 解释 + 易混提示卡片。
 * tags 参数保留用于兼容老调用，匹配范围始终是整本词典。
 */
export function renderStemWithTerms(
  text: string,
  _tags: string[] | undefined,
  dict: TermDict,
): React.ReactNode {
  return renderWithTerms(text, dict);
}

export function renderWithTerms(text: string, dict: TermDict): React.ReactNode {
  if (!text) return null;
  const terms = Object.values(dict);
  if (terms.length === 0) return text;

  // 长词优先，避免 "marginal cost" 被 "cost" 抢先匹配
  const sorted = [...terms].sort((a, b) => b.term_en.length - a.term_en.length);
  const pattern = new RegExp(
    `\\b(${sorted.map((t) => t.term_en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "gi",
  );

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const matched = m[0];
    const info = dict[matched.toLowerCase()];
    if (info) {
      parts.push(<TermPopover key={key++} text={matched} info={info} dict={dict} />);
    } else {
      parts.push(matched);
    }
    last = m.index + matched.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function TermPopover({ text, info, dict }: { text: string; info: TermInfo; dict: TermDict }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<TermInfo>(info);

  const confusables = useMemo(() => {
    const list = current.confusable_with ?? [];
    return list
      .map((c) => {
        const hit = dict[c.toLowerCase()];
        return hit ? { en: hit.term_en, zh: hit.term_zh, info: hit } : { en: c, zh: "", info: null as TermInfo | null };
      })
      .filter((x) => x.en);
  }, [current, dict]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setCurrent(info); }}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="cursor-pointer underline decoration-dotted decoration-primary/70 underline-offset-4 text-foreground/90 hover:text-primary"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
        >
          {text}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{current.term_en}</span>
            <span className="text-sm text-primary">{current.term_zh}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{current.definition}</p>
          {confusables.length > 0 && (
            <div className="pt-2 border-t">
              <div className="text-[11px] text-muted-foreground mb-1">易混术语</div>
              <div className="flex flex-wrap gap-1.5">
                {confusables.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={!c.info}
                    onClick={() => c.info && setCurrent(c.info)}
                    className="text-xs px-2 py-0.5 rounded-full border border-warning/40 bg-warning/10 text-foreground hover:bg-warning/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={c.info ? "点击查看" : "词典中暂无该术语"}
                  >
                    <span className="font-medium">{c.en}</span>
                    {c.zh && <span className="text-muted-foreground ml-1">{c.zh}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}