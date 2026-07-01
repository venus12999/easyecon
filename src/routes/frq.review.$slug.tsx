import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Trophy, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FrqGradeCard, type GradeResult } from "@/components/frq/FrqGradeCard";
import { FrqContent } from "@/components/frq/FrqContent";

export const Route = createFileRoute("/frq/review/$slug")({
  head: () => ({ meta: [{ title: "大题合集 · 评分回放" }] }),
  component: FrqReviewPage,
});

type FrqRow = {
  id: string;
  title: string | null;
  content: string;
  max_score: number;
  sort_order: number;
};

type SubmissionRow = {
  frq_id: string;
  ai_score: number | null;
  ai_max_score: number | null;
  ai_breakdown: GradeResult["breakdown"] | null;
  ai_overall: string | null;
  ai_suggestions: string | null;
  answer_text: string | null;
  answer_file_url: string | null;
  answer_file_kind: string | null;
  created_at: string;
};

function FrqReviewPage() {
  const { slug } = useParams({ from: "/frq/review/$slug" });
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [paperTitle, setPaperTitle] = useState("");
  const [frqs, setFrqs] = useState<FrqRow[]>([]);
  const [subs, setSubs] = useState<Record<string, SubmissionRow>>({});

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      const { data: paper } = await supabase
        .from("mock_papers")
        .select("id,title")
        .eq("slug", slug)
        .maybeSingle();
      if (!paper) {
        setLoading(false);
        return;
      }
      setPaperTitle(paper.title);
      const [{ data: frqRows }, { data: subRows }] = await Promise.all([
        supabase
          .from("paper_frqs")
          .select("id,title,content,max_score,sort_order")
          .eq("paper_id", paper.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("frq_submissions")
          .select(
            "frq_id,ai_score,ai_max_score,ai_breakdown,ai_overall,ai_suggestions,answer_text,answer_file_url,answer_file_kind,created_at",
          )
          .eq("user_id", user.id)
          .eq("paper_id", paper.id)
          .order("created_at", { ascending: false }),
      ]);
      setFrqs((frqRows ?? []) as FrqRow[]);
      const latest: Record<string, SubmissionRow> = {};
      ((subRows ?? []) as SubmissionRow[]).forEach((r) => {
        if (!latest[r.frq_id]) latest[r.frq_id] = r; // 已按时间倒序
      });
      setSubs(latest);
      setLoading(false);
    })();
  }, [slug, user, authLoading]);

  const stats = useMemo(() => {
    let earned = 0;
    let max = 0;
    let done = 0;
    frqs.forEach((f) => {
      max += f.max_score;
      const s = subs[f.id];
      if (s && s.ai_score != null && s.ai_max_score) {
        earned += s.ai_score;
        done += 1;
      }
    });
    return {
      earned,
      max,
      done,
      total: frqs.length,
      pct: max ? Math.round((earned / max) * 100) : 0,
    };
  }, [frqs, subs]);

  if (authLoading || loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center space-y-3">
        <p className="text-muted-foreground">请先登录后查看评分回放</p>
        <Button asChild><Link to="/auth">登录</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Link
        to="/frq"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回大题刷题
      </Link>

      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Trophy className="h-4 w-4" /> 评分回放
        </div>
        <h1 className="mt-1 text-2xl font-bold">{paperTitle}</h1>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm text-muted-foreground">合计得分</div>
              <div className="mt-1 text-4xl font-bold text-primary">
                {stats.earned}
                <span className="ml-1 text-lg text-muted-foreground">/ {stats.max}</span>
                <span className="ml-2 text-sm text-muted-foreground">({stats.pct}%)</span>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              已评分 {stats.done} / {stats.total} 题
            </div>
          </div>
          <Progress value={stats.max ? (stats.earned / stats.max) * 100 : 0} className="h-2" />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/mock/$slug" params={{ slug }}>
                <RotateCcw className="h-3.5 w-3.5" /> 重新作答整套
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {frqs.map((f, i) => {
          const s = subs[f.id];
          const grade: GradeResult | null =
            s && s.ai_score != null && s.ai_max_score
              ? {
                  total_score: s.ai_score,
                  max_score: s.ai_max_score,
                  breakdown: s.ai_breakdown ?? [],
                  overall_comment: s.ai_overall ?? "",
                  suggestions: s.ai_suggestions ?? "",
                }
              : null;
          return (
            <Card key={f.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold">
                    第 {i + 1} 题
                    {f.title ? ` · ${f.title}` : ""}
                    <span className="ml-2 text-xs text-muted-foreground">满分 {f.max_score} 分</span>
                  </div>
                  {grade ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {grade.total_score} / {grade.max_score}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      未作答
                    </span>
                  )}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    查看题目原文
                  </summary>
                  <div className="mt-2 rounded bg-muted p-3 text-[12px] leading-relaxed">
                    <FrqContent content={f.content} />
                  </div>
                </details>
                {s?.answer_text && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      你的作答
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-[12px]">
                      {s.answer_text}
                    </pre>
                  </details>
                )}
                {s?.answer_file_url && (
                  <a
                    href={s.answer_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs text-primary underline"
                  >
                    查看上传文件
                  </a>
                )}
                {grade ? (
                  <FrqGradeCard grade={grade} />
                ) : (
                  <p className="text-xs text-muted-foreground">本题未作答，未评分。</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}