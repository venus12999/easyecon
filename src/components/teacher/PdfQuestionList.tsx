import { useEffect, useState } from "react";
import { mediaSrcRetry } from "@/lib/media-src";
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
  rubric_note?: string;
  image_url?: string | null;
  page_image_url?: string | null;
  needs_image?: boolean;
};

export type PdfAiFinding = { key: string; reason: string };

function itemKey(it: TeacherPdfItem) {
  return `${it.kind}-${it.sort_order}`;
}

function CropThumb({
  src,
  fallback,
  label,
  onStatus,
}: {
  src?: string | null;
  fallback?: string | null;
  label: string;
  onStatus?: (status: "ok" | "weak" | "broken") => void;
}) {
  const [mode, setMode] = useState<"src" | "fallback" | "broken">(src ? "src" : fallback ? "fallback" : "broken");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setMode(src ? "src" : fallback ? "fallback" : "broken");
    setAttempt(0);
  }, [src, fallback]);
  const raw = mode === "src" ? src : mode === "fallback" ? fallback : null;
  const url = raw ? mediaSrcRetry(raw, attempt) : null;
  if (!url) {
    return (
      <div className="flex h-24 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-muted/40 px-1 text-center text-[11px] text-muted-foreground">
        <span>截图缺失</span>
        {src || fallback ? (
          <button type="button" className="text-primary" onClick={() => { setMode(src ? "src" : "fallback"); setAttempt((n) => n + 1); }}>重试</button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="shrink-0">
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          key={url}
          src={url}
          alt={label}
          className="max-h-24 max-w-[10rem] rounded border border-border object-contain bg-white"
          onLoad={(e) => {
            const img = e.currentTarget;
            const thin = img.naturalHeight < 72 || (img.naturalWidth / Math.max(1, img.naturalHeight) > 8 && img.naturalHeight < 160);
            onStatus?.(thin ? "weak" : "ok");
          }}
          onError={() => {
            onStatus?.("broken");
            if (attempt < 2) {
              setAttempt((n) => n + 1);
              return;
            }
            if (mode === "src" && fallback && fallback !== src) {
              setMode("fallback");
              setAttempt(0);
              return;
            }
            setMode("broken");
          }}
        />
      </a>
      <button type="button" className="mt-1 text-[11px] text-primary" onClick={() => { setMode(src ? "src" : "fallback"); setAttempt((n) => n + 1); }}>重新加载</button>
    </div>
  );
}

export function PdfQuestionList({
  items,
  findings,
  aiRan,
  onChange,
  onRemove,
  onReplaceImage,
  onRecrop,
  locked,
}: {
  items: TeacherPdfItem[];
  findings: PdfAiFinding[];
  aiRan?: boolean;
  onChange: (index: number, patch: Partial<TeacherPdfItem>) => void;
  onRemove: (index: number) => void;
  onReplaceImage?: (index: number, file: File) => void;
  onRecrop?: (index: number) => void;
  locked?: boolean;
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
          <span className="text-xs text-muted-foreground">
            {findings.length >= items.length
              ? items.length === 1
                ? "这一道需要看一眼，改完再提交。"
                : "标出的题都需要看一眼，改完再提交。"
              : `另外 ${items.length - findings.length} 道没有被标出，有需要再点编辑。`}
          </span>
        </div>
      )}
      {visible.map(({ it, idx, reason }) => (
        <PdfQuestionCard
          key={`${it.kind}-${it.sort_order}-${idx}`}
          it={it}
          idx={idx}
          reason={reason}
          open={editing === idx}
          aiRan={aiRan}
          onToggle={() => setEditing(open => (open === idx ? null : idx))}
          onChange={onChange}
          onRemove={onRemove}
          onReplaceImage={onReplaceImage}
          onRecrop={onRecrop}
          locked={locked}
        />
      ))}
    </div>
  );
}

function PdfQuestionCard({
  it,
  idx,
  reason,
  open,
  aiRan,
  onToggle,
  onChange,
  onRemove,
  onReplaceImage,
  onRecrop,
  locked,
}: {
  it: TeacherPdfItem;
  idx: number;
  reason?: string;
  open: boolean;
  aiRan?: boolean;
  onToggle: () => void;
  onChange: (index: number, patch: Partial<TeacherPdfItem>) => void;
  onRemove: (index: number) => void;
  onReplaceImage?: (index: number, file: File) => void;
  onRecrop?: (index: number) => void;
  locked?: boolean;
}) {
  const [shot, setShot] = useState<"ok" | "weak" | "broken" | "none">("none");
  useEffect(() => {
    setShot("none");
  }, [it.image_url]);
  const figureReady = !!it.image_url && shot === "ok";
  return (
          <Card key={`${it.kind}-${it.sort_order}-${idx}`} className={reason ? "overflow-hidden border-amber-300" : "overflow-hidden"}>
            <CardContent className="p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-bold font-mono">
                        {it.kind === "mcq" ? `#${it.sort_order}` : `Q${it.sort_order}`}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary">{it.kind === "mcq" ? "选择题" : "大题"}</span>
                      {it.needs_image && (
                        <span className={`text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${figureReady ? "bg-primary/15 text-primary" : "bg-amber-500/15 text-amber-900"}`}>
                          <ImageIcon className="h-3 w-3" /> {figureReady ? "已截图" : shot === "weak" ? "截图不完整" : "带图待补"}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{it.kind === "frq" && it.max_score < 1 ? "未填分值" : `${it.max_score || 1} 分`}</span>
                      {reason ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground">需修改</span>
                      ) : it.kind === "mcq" && !/^[A-E]$/.test((it.correct_answer ?? "").trim()) ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-900">待填答案</span>
                      ) : aiRan ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-success/15 text-success">AI 通过</span>
                      ) : null}
                    </div>
                    <p className="text-sm line-clamp-2">{it.kind === "frq" ? (it.content || it.stem) : it.stem}</p>
                    {it.kind === "mcq" && !open && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-1">
                        A. {it.option_a} · B. {it.option_b} · C. {it.option_c} · D. {it.option_d}{it.option_e ? ` · E. ${it.option_e}` : ""}
                        {it.correct_answer ? ` · 答案 ${it.correct_answer}` : ""}
                      </p>
                    )}
                    {reason && <p className="text-xs text-amber-800 mt-1">{reason}</p>}
                  </div>
                  {it.image_url || (it.needs_image && it.page_image_url) ? (
                    <CropThumb src={it.image_url} fallback={it.needs_image ? it.page_image_url : null} label={`第 ${it.sort_order} 题截图`} onStatus={setShot} />
                  ) : (
                    <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-[11px] text-muted-foreground">
                      无截图
                    </div>
                  )}
                </div>
                {open && (
                  <div className="space-y-2 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={it.kind} onValueChange={(v) => onChange(idx, {
                        kind: v as "mcq" | "frq",
                        max_score: v === "mcq" ? (it.max_score >= 1 && it.max_score !== 9 ? it.max_score : 1) : it.max_score > 0 && it.max_score !== 9 ? it.max_score : 0,
                      })}>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-white px-2.5 py-1.5 text-xs">
                        替换图片
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onReplaceImage?.(idx, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {onRecrop ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onRecrop(idx)}>
                          在本页框选图表
                        </Button>
                      ) : null}
                    </div>
                    {it.kind === "mcq" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((k, n) => (
                          <Input key={k} placeholder={`选项 ${"ABCDE"[n]}`} value={it[k]} onChange={(e) => onChange(idx, { [k]: e.target.value })} />
                        ))}
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-2" role="radiogroup" aria-label="正确答案">
                          <span className="text-xs text-muted-foreground">正确答案</span>
                          {(["A", "B", "C", "D", "E"] as const).map((letter) => {
                            const selected = it.correct_answer === letter;
                            return (
                              <button
                                key={letter}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={selected
                                  ? "grid h-9 w-9 place-items-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground"
                                  : "grid h-9 w-9 place-items-center rounded-full border border-border bg-white text-sm font-semibold"}
                                onClick={() => onChange(idx, { correct_answer: selected ? "" : letter })}
                              >
                                {letter}
                              </button>
                            );
                          })}
                        </div>
                        <Input type="number" min={1} max={20} aria-label="选择题分值" placeholder="分值" value={it.max_score || 1} onChange={(e) => onChange(idx, { max_score: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} />
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <Textarea placeholder="大题文字（学生看得到）" value={it.content} onChange={(e) => onChange(idx, { content: e.target.value })} />
                        <Textarea placeholder="参考答案（学生看不到，AI 批改会用）" value={it.correct_answer} onChange={(e) => onChange(idx, { correct_answer: e.target.value })} />
                        <Textarea placeholder="评分标准，一行一个得分点（学生看不到）" value={it.rubric_note ?? ""} onChange={(e) => onChange(idx, { rubric_note: e.target.value })} />
                        <Input type="number" min={1} max={20} placeholder="满分，卷面没认出时请填写" aria-label="大题满分" value={it.max_score > 0 ? it.max_score : ""} onChange={(e) => onChange(idx, { max_score: Math.min(20, Math.max(0, Number(e.target.value) || 0)) })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {locked ? (
                  <span className="text-xs text-muted-foreground">已锁定</span>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={onToggle}>
                      {open ? "收起" : "编辑"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onRemove(idx)}>删除</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
  );
}
