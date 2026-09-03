import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChevronRight, Sparkles, ArrowLeft, ChevronDown, SlidersHorizontal, History, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/practice/")({
  head: () => ({
    meta: [
      { title: "选择题 · 按知识点刷题 | EasyEcon" },
      { name: "description", content: "按 Unit 与知识点选择 AP 微观/宏观经济选择题，查看每个知识点的题量与练习进度。" },
      { property: "og:title", content: "选择题 · 按知识点刷题" },
      { property: "og:description", content: "按 Unit 与知识点选择 AP 经济选择题，追踪每轮练习进度。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PracticeIndex,
});

type Kp = {
  id: string;
  unit: number;
  slug: string;
  name_en: string;
  name_zh: string;
  description: string | null;
  sort_order: number;
};

type Counts = Record<string, { total: number; draft: number }>;
type KpProgressInfo = { done: number; total: number; round: number; attempts: number; correct: number };

function PracticeIndex() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [kps, setKps] = useState<Kp[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [unit, setUnit] = useState<number | null>(null);
  const [kpProgress, setKpProgress] = useState<Record<string, KpProgressInfo>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Kp | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: kpData } = await supabase
        .from("knowledge_points")
        .select("*")
        .order("unit")
        .order("sort_order");
      const { data: qData } = await supabase
        .from("questions")
        .select("knowledge_point_id,status")
        .eq("exclude_from_pool", false);
      const c: Counts = {};
      (qData ?? []).forEach((q) => {
        const k = q.knowledge_point_id as string;
        if (!c[k]) c[k] = { total: 0, draft: 0 };
        if (q.status === "published") c[k].total += 1;
        else c[k].draft += 1;
      });
      const kpList = (kpData ?? []) as Kp[];
      setKps(kpList);
      setCounts(c);
      setLoading(false);
    })();
  }, []);

  const loadProgress = useCallback(async () => {
    if (!user) {
      setKpProgress({});
      return;
    }
    if (Object.keys(counts).length === 0) return;
    const { data } = await supabase
      .from("answer_attempts")
      .select("knowledge_point_id,question_id,is_correct,created_at")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    const grouped: Record<string, { qid: string; ok: boolean }[]> = {};
    (data ?? []).forEach((r) => {
      const k = r.knowledge_point_id as string;
      (grouped[k] ??= []).push({ qid: r.question_id as string, ok: !!r.is_correct });
    });
    const next: Record<string, KpProgressInfo> = {};
    for (const [kpId, rows] of Object.entries(grouped)) {
      const total = counts[kpId]?.total ?? 0;
      if (total === 0) continue;
      let round = 1;
      let seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.qid);
        if (seen.size >= total) {
          round += 1;
          seen = new Set();
        }
      }
      const done = seen.size === 0 && round > 1 ? total : seen.size;
      const displayRound = seen.size === 0 && round > 1 ? round - 1 : round;
      next[kpId] = {
        done,
        total,
        round: displayRound,
        attempts: rows.length,
        correct: rows.filter((r) => r.ok).length,
      };
    }
    setKpProgress(next);
  }, [user, counts]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  async function confirmReset() {
    if (!resetTarget || !user) return;
    setResetting(true);
    const { error } = await supabase
      .from("answer_attempts")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("knowledge_point_id", resetTarget.id)
      .is("archived_at", null);
    setResetting(false);
    if (error) {
      toast.error("清空失败，请稍后再试");
      return;
    }
    toast.success("成绩已清空，旧记录已存入历史记录");
    setResetTarget(null);
    await loadProgress();
  }

  const allUnits = Array.from(new Set(kps.map((k) => k.unit))).sort((a, b) => a - b);
  const visibleKps = unit == null ? kps : kps.filter((k) => k.unit === unit);

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </Link>
        <h1 className="text-lg font-bold tracking-tight sm:text-3xl">选择题</h1>
        <Link
          to="/history"
          search={{ tab: "mcq" }}
          className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline sm:text-sm"
        >
          <History className="h-3.5 w-3.5" /> 历史记录
        </Link>

        {/* Desktop header — always visible */}
        <section className="hidden sm:flex mt-4 mb-2.5 items-center gap-2 text-xs text-primary font-medium">
          <Sparkles className="h-3.5 w-3.5" /> 知识点 · 选一个开始
        </section>

        {/* Mobile collapsible filter toggle — hidden on desktop */}
        {isMobile && allUnits.length > 0 && !loading && (
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="mt-4 mb-2 flex w-full items-center justify-between rounded-pill border bg-card px-3 py-2 text-xs font-medium text-primary"
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {unit != null ? `Unit ${unit} · ${visibleKps.length} 个知识点` : `全部单元 · ${visibleKps.length} 个知识点`}
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", filterOpen && "rotate-180")} />
          </button>
        )}

        {/* Filter chips — always visible on desktop, collapsible on mobile */}
        {allUnits.length > 0 && (
          <div className={cn("mb-4 flex flex-wrap gap-2", isMobile && !filterOpen && "hidden")}>
            <button
              type="button"
              onClick={() => setUnit(null)}
              className={`px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm rounded-pill border transition-colors ${
                unit == null ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
              }`}
            >
              全部
            </button>
            {allUnits.map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm rounded-pill border transition-colors ${
                  unit === u ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
                }`}
              >
                Unit {u}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 sm:h-40 rounded-card border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleKps.map((kp) => {
              const c = counts[kp.id] ?? { total: 0, draft: 0 };
              const n = c.total;
              const kpInfo = kpProgress[kp.id];
              const finished = !!kpInfo && n > 0 && kpInfo.done >= kpInfo.total;
              const accuracy = kpInfo && kpInfo.attempts > 0 ? Math.round((kpInfo.correct / kpInfo.attempts) * 100) : null;
              return (
                <div key={kp.id} className="group relative">
                <Link to="/practice/$slug" params={{ slug: kp.slug }} search={{}} className="block">
                  <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
                    <CardHeader className="p-3.5 pb-2 sm:p-6 sm:pb-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm sm:text-base">{kp.name_zh}</CardTitle>
                          <CardDescription className="mt-0.5 text-[10px] sm:text-xs font-mono">{kp.name_en}</CardDescription>
                        </div>
                        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0 space-y-1.5 sm:p-6 sm:pt-0 sm:space-y-2">
                      {kp.description && (
                        <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2">{kp.description}</p>
                      )}
                      <div className="flex items-center justify-between text-[11px] sm:text-xs">
                        <span className="text-muted-foreground">
                          {n > 0 ? `${n} 题` : c.draft > 0 ? `暂无题目（${c.draft} 道待审核）` : "暂无题目"}
                        </span>
                        {kpInfo && n > 0 ? (
                          <span className="text-primary font-medium">
                            {kpInfo.round > 1 ? `第${kpInfo.round}轮 ` : ""}
                            {kpInfo.done}/{kpInfo.total}
                            {accuracy != null ? ` · ${accuracy}%` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未开始</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                {finished && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setResetTarget(kp);
                    }}
                    className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-pill border border-primary/40 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 sm:bottom-4 sm:right-4 sm:text-[11px]"
                  >
                    <RotateCcw className="h-3 w-3" /> 清空重做
                  </button>
                )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空「{resetTarget?.name_zh}」的成绩？</AlertDialogTitle>
            <AlertDialogDescription>
              当前这一轮的答题与正确率会清零并重新开始；旧成绩会保留在「历史记录」里随时查看。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction disabled={resetting} onClick={(e) => { e.preventDefault(); void confirmReset(); }}>
              确定清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
