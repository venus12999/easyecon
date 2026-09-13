import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon } from "lucide-react";

export type TeacherPdfItem = {
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
  reviewed: boolean;
  image_url?: string | null;
  page_image_url?: string | null;
  needs_image?: boolean;
};

export type PdfAiFinding = { key: string; reason: string };

function itemKey(it: TeacherPdfItem) {
  return `${it.kind}-${it.sort_order}`;
}

function CropThumb({ src, fallback, label }: { src?: string | null; fallback?: string | null; label: string }) {
  const [mode, setMode] = useState<"src" | "fallback" | "broken">(src ? "src" : fallback ? "fallback" : "broken");
  useEffect(() => {
    setMode(src ? "src" : fallback ? "fallback" : "broken");
  }, [src, fallback]);
  const url = mode === "src" ? src : mode === "fallback" ? fallback : null;
  if (!url) {
    return (
      <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-[11px] text-muted-foreground">
        截图缺失
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block shrink-0">
      <img
        src={url}
        alt={label}
        className="max-h-24 max-w-[10rem] rounded border border-border object-contain bg-white"
        onError={() => {
          if (mode === "src" && fallback && fallback !== src) setMode("fallback");
          else setMode("broken");
        }}
      />
    </a>
  );
}

export function PdfQuestionList({
  items,
  findings,
  aiRan,
  onChange,
  onRemove,
}: {
  items: TeacherPdfItem[];
  findings: PdfAiFinding[];
  aiRan?: boolean;
  onChange: (index: number, patch: Partial<TeacherPdfItem>) => void;
  onRemove: (index: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flag = new Map(findings.map((f) => [f.key, f.reason]));
  const rows = items.map((it, idx) => ({ it, idx, reason: flag.get(itemKey(it)) }));
  const visible = onlyFlagged ? rows.filter((r) => r.reason) : rows;

  return (
    <div className="space-y-2">
      {findings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <Button size="sm" variant={onlyFlagged ? "default" : "outline"} onClick={() => setOnlyFlagged((v) => !v)}>
            {onlyFlagged ? "查看全部题目" : `只看需修改（${findings.length}）`}
          </Button>
          <span className="text-xs text-muted-foreground">其余题目 AI 已通过，有需要再点编辑。</span>
        </div>
      )}
      {visible.map(({ it, idx, reason }) => {
        const open = editing === idx;
        return (
          <Card key={`${it.kind}-${it.sort_order}-${idx}`} className={reason ? "overflow-hidden border-amber-300" : "overflow-hidden"}>
            <CardContent className="p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-bold font-mono">
                        {it.kind === "mcq" ? `#${it.sort_order}` : `FRQ ${it.sort_order}`}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary">{it.kind === "mcq" ? "选择题" : "大题"}</span>
                      {it.needs_image && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary inline-flex items-center gap-1">
                          <ImageIcon className="h-3 w-3" /> {it.image_url ? "已截图" : "带图待补"}
                        </span>
                      )}
                      {reason ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground">需修改</span>
                      ) : aiRan ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-success/15 text-success">AI 通过</span>
                      ) : null}
                    </div>
                    <p className="text-sm line-clamp-2">{it.kind === "frq" ? (it.content || it.stem) : it.stem}</p>
                    {it.kind === "mcq" && !open && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-1">
                        A. {it.option_a} · B. {it.option_b} · C. {it.option_c} · D. {it.option_d}
                        {it.correct_answer ? ` · 答案 ${it.correct_answer}` : ""}
                      </p>
                    )}
                    {reason && <p className="text-xs text-amber-800 mt-1">{reason}</p>}
                  </div>
                  {it.image_url ? (
                    <CropThumb src={it.image_url} fallback={null} label={`第 ${it.sort_order} 题截图`} />
                  ) : (
                    <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-[11px] text-muted-foreground">
                      无截图
                    </div>
                  )}
                </div>
                {open && (
                  <div className="space-y-2 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={it.kind} onValueChange={(v) => onChange(idx, { kind: v as "mcq" | "frq" })}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mcq">选择题</SelectItem>
                          <SelectItem value="frq">大题</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="w-24"
                        type="number"
                        aria-label="页码"
                        value={it.page_number}
                        onChange={(e) => onChange(idx, { page_number: Number(e.target.value) })}
                      />
                    </div>
                    <Input placeholder="题干" value={it.stem} onChange={(e) => onChange(idx, { stem: e.target.value })} />
                    {it.kind === "mcq" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((k, n) => (
                          <Input key={k} placeholder={`选项 ${"ABCDE"[n]}`} value={it[k]} onChange={(e) => onChange(idx, { [k]: e.target.value })} />
                        ))}
                        <Input placeholder="正确答案 A-E（选填）" value={it.correct_answer} onChange={(e) => onChange(idx, { correct_answer: e.target.value.toUpperCase() })} />
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Textarea placeholder="大题文字" value={it.content} onChange={(e) => onChange(idx, { content: e.target.value })} />
                        <Input type="number" placeholder="满分" value={it.max_score} onChange={(e) => onChange(idx, { max_score: Number(e.target.value) })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => setEditing(open ? null : idx)}>
                  {open ? "收起" : "编辑"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(idx)}>删除</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
