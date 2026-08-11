import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Loader2, X } from "lucide-react";
import { FrqContent } from "@/components/frq/FrqContent";
import { FrqGradeCard, type GradeResult } from "@/components/frq/FrqGradeCard";

export type DetailTarget =
  | { kind: "mcq"; title: string; knowledgePointId: string; archivedAt: string | null }
  | { kind: "frq"; title: string; paperId: string; archivedAt: string | null }
  | { kind: "mock"; title: string; attemptId: string };

type QuestionRow = {
  id: string;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string | null;
  correct_answer: string;
  explanation: string;
  pitfall_note: string | null;
};

type McqItem = { question: QuestionRow | null; picked: string | null; isCorrect: boolean };

type FrqItem = {
  title: string;
  content: string;
  answerText: string | null;
  answerFileUrl: string | null;
  grade: GradeResult | null;
};

function optionText(q: QuestionRow, letter: string | null) {
  if (!letter) return null;
  const map: Record<string, string | null> = {
    A: q.option_a,
    B: q.option_b,
    C: q.option_c,
    D: q.option_d,
    E: q.option_e,
  };
  return map[letter] ?? null;
}

function McqList({ items }: { items: McqItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">这一轮没有可回看的题目记录。</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((it, i) => {
        const q = it.question;
        return (
          <Card key={i}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-semibold text-muted-foreground">第 {i + 1} 题</div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    it.isCorrect ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {it.isCorrect ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {it.isCorrect ? "正确" : "错误"}
                </span>
              </div>
              {q ? (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.stem}</p>
                  <div className="space-y-1 text-sm">
                    {(["A", "B", "C", "D", "E"] as const).map((L) => {
                      const text = optionText(q, L);
                      if (!text) return null;
                      const isCorrect = q.correct_answer === L;
                      const isPicked = it.picked === L;
                      return (
                        <div
                          key={L}
                          className={`rounded-md px-2 py-1.5 ${
                            isCorrect
                              ? "bg-success/10 text-success"
                              : isPicked
                                ? "bg-destructive/10 text-destructive"
                                : "text-muted-foreground"
                          }`}
                        >
                          <span className="font-semibold">{L}.</span> {text}
                          {isPicked && <span className="ml-2 text-[11px]">（我的选择）</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                    <div className="mb-1 text-xs font-semibold">解析</div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{q.explanation}</p>
                    {q.pitfall_note && (
                      <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                        易错提示：{q.pitfall_note}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  题目已不可用，仅保留作答结果（我的选择：{it.picked ?? "未作答"}）。
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FrqList({ items }: { items: FrqItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">这一轮没有可回看的大题记录。</p>;
  }
  return (
    <div className="space-y-4">
      {items.map((it, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <div className="text-sm font-semibold">
              {it.title || `大题 ${i + 1}`}
            </div>
            <FrqContent content={it.content} className="text-sm leading-relaxed text-muted-foreground" />
            <div>
              <div className="mb-1 text-xs font-semibold">我的答案</div>
              {it.answerText ? (
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                  {it.answerText}
                </p>
              ) : it.answerFileUrl ? (
                <a
                  href={it.answerFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  查看提交的文件
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">未作答</p>
              )}
            </div>
            {it.grade ? (
              <FrqGradeCard grade={it.grade} />
            ) : (
              <p className="text-sm text-muted-foreground">这道题没有 AI 评分记录。</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function HistoryDetailDialog({
  target,
  onClose,
}: {
  target: DetailTarget | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [mcqItems, setMcqItems] = useState<McqItem[]>([]);
  const [frqItems, setFrqItems] = useState<FrqItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setMcqItems([]);
      setFrqItems([]);
      try {
        if (target.kind === "mcq" || target.kind === "mock") {
          let picks: { question_id: string; picked: string | null; isCorrect: boolean }[] = [];
          if (target.kind === "mcq") {
            let q = supabase
              .from("answer_attempts")
              .select("question_id,picked_answer,is_correct,created_at")
              .eq("knowledge_point_id", target.knowledgePointId)
              .eq("mode", "practice")
              .order("created_at", { ascending: true });
            q = target.archivedAt
              ? q.eq("archived_at", target.archivedAt)
              : q.is("archived_at", null);
            const { data, error: err } = await q;
            if (err) throw err;
            picks = (data ?? []).map((r) => ({
              question_id: r.question_id as string,
              picked: (r.picked_answer as string | null) ?? null,
              isCorrect: !!r.is_correct,
            }));
          } else {
            const { data, error: err } = await supabase
              .from("mock_attempts")
              .select("detail")
              .eq("id", target.attemptId)
              .maybeSingle();
            if (err) throw err;
            const detail = (data?.detail ?? []) as {
              question_id?: string;
              picked?: string | null;
              is_correct?: boolean;
            }[];
            picks = (Array.isArray(detail) ? detail : [])
              .filter((d) => !!d.question_id)
              .map((d) => ({
                question_id: d.question_id as string,
                picked: d.picked ?? null,
                isCorrect: !!d.is_correct,
              }));
          }

          const ids = Array.from(new Set(picks.map((p) => p.question_id)));
          const qMap = new Map<string, QuestionRow>();
          if (ids.length > 0) {
            const { data: qs, error: qErr } = await supabase
              .from("questions")
              .select(
                "id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,pitfall_note",
              )
              .in("id", ids);
            if (qErr) throw qErr;
            ((qs ?? []) as QuestionRow[]).forEach((q) => qMap.set(q.id, q));
          }
          if (cancelled) return;
          setMcqItems(
            picks.map((p) => ({
              question: qMap.get(p.question_id) ?? null,
              picked: p.picked,
              isCorrect: p.isCorrect,
            })),
          );
        } else {
          let q = supabase
            .from("frq_submissions")
            .select(
              "frq_id,answer_text,answer_file_url,ai_score,ai_max_score,ai_breakdown,ai_overall,ai_suggestions,created_at",
            )
            .eq("paper_id", target.paperId)
            .order("created_at", { ascending: true });
          q = target.archivedAt
            ? q.eq("archived_at", target.archivedAt)
            : q.is("archived_at", null);
          const { data, error: err } = await q;
          if (err) throw err;
          const rows = data ?? [];
          const frqIds = Array.from(new Set(rows.map((r) => r.frq_id as string)));
          const metaMap = new Map<string, { title: string | null; content: string; sort_order: number; max_score: number }>();
          if (frqIds.length > 0) {
            const { data: metas, error: mErr } = await supabase
              .from("paper_frqs")
              .select("id,title,content,sort_order,max_score")
              .in("id", frqIds);
            if (mErr) throw mErr;
            (metas ?? []).forEach((m) =>
              metaMap.set(m.id as string, {
                title: m.title as string | null,
                content: (m.content as string) ?? "",
                sort_order: (m.sort_order as number) ?? 0,
                max_score: (m.max_score as number) ?? 0,
              }),
            );
          }
          if (cancelled) return;
          const items: FrqItem[] = rows
            .map((r) => {
              const meta = metaMap.get(r.frq_id as string);
              const breakdown = (r.ai_breakdown ?? []) as GradeResult["breakdown"];
              const hasGrade = r.ai_score != null || (Array.isArray(breakdown) && breakdown.length > 0);
              return {
                sort: meta?.sort_order ?? 0,
                item: {
                  title: meta?.title ?? "",
                  content: meta?.content ?? "",
                  answerText: (r.answer_text as string | null) ?? null,
                  answerFileUrl: (r.answer_file_url as string | null) ?? null,
                  grade: hasGrade
                    ? {
                        total_score: (r.ai_score as number | null) ?? 0,
                        max_score: (r.ai_max_score as number | null) ?? meta?.max_score ?? 0,
                        breakdown: Array.isArray(breakdown) ? breakdown : [],
                        overall_comment: (r.ai_overall as string | null) ?? "",
                        suggestions: (r.ai_suggestions as string | null) ?? "",
                      }
                    : null,
                },
              };
            })
            .sort((a, b) => a.sort - b.sort)
            .map((x) => x.item);
          setFrqItems(items);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败，请稍后再试。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{target?.title ?? "回看详情"}</DialogTitle>
          <DialogDescription>
            {target?.kind === "frq" ? "逐题答案与 AI 评分" : "逐题作答与解析"}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : target?.kind === "frq" ? (
          <FrqList items={frqItems} />
        ) : (
          <McqList items={mcqItems} />
        )}
      </DialogContent>
    </Dialog>
  );
}