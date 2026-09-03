import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, FileText, History, Loader2, PlayCircle, SquarePen, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { FRQ_CATEGORIES, getFrqUnit } from "@/lib/frq-categories";

export const Route = createFileRoute("/frq")({
  head: () => ({
    meta: [
      { title: "AP 微观经济大题分类刷题" },
      { name: "description", content: "按 AP 微观经济 Unit 分类练习 FRQ 大题，并按得分点获得评分。" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { unit?: number } => {
    const unit = Number(search.unit);
    return { unit: Number.isInteger(unit) && unit >= 1 && unit <= 6 ? unit : undefined };
  },
  component: FrqCategoriesPage,
});

type FrqListItem = {
  id: string;
  title: string | null;
  content: string;
  max_score: number;
  sort_order: number;
};

type FrqPack = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  total_seconds: number;
  frq_count: number;
  frq_ids: string[];
};

function FrqCategoriesPage() {
  const { unit } = Route.useSearch();
  const { user } = useAuth();
  const [frqs, setFrqs] = useState<FrqListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [packs, setPacks] = useState<FrqPack[]>([]);
  const [doneByPaper, setDoneByPaper] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    void (async () => {
      const { data: paper } = await supabase
        .from("mock_papers")
        .select("id")
        .eq("slug", "frq-pdf-practice")
        .maybeSingle();
      if (paper) {
        const { data } = await supabase
          .from("paper_frqs")
          .select("id,title,content,max_score,sort_order")
          .eq("paper_id", paper.id)
          .order("sort_order", { ascending: true });
        setFrqs((data ?? []) as FrqListItem[]);
      }
      const { data: packPapers } = await supabase
        .from("mock_papers")
        .select("id,slug,title,description,total_seconds,paper_frqs(id,sort_order)")
        .like("slug", "frq-pack-%")
        .order("sort_order", { ascending: true });
      const mappedPacks = ((packPapers ?? []) as Array<{
          id: string;
          slug: string;
          title: string;
          description: string | null;
          total_seconds: number;
        paper_frqs: { id: string; sort_order: number }[];
      }>).map((p) => {
        const ids = (p.paper_frqs ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((f) => f.id);
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          description: p.description,
          total_seconds: p.total_seconds,
          frq_count: ids.length,
          frq_ids: ids,
        };
      });
      setPacks(mappedPacks);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!user || packs.length === 0) {
      setDoneByPaper({});
      return;
    }
    const paperIds = packs.map((p) => p.id);
    void supabase
      .from("frq_submissions")
      .select("paper_id,frq_id")
      .eq("user_id", user.id)
      .in("paper_id", paperIds)
      .is("archived_at", null)
      .then(({ data }) => {
        const map: Record<string, Set<string>> = {};
        ((data ?? []) as { paper_id: string; frq_id: string }[]).forEach((r) => {
          (map[r.paper_id] ??= new Set()).add(r.frq_id);
        });
        setDoneByPaper(map);
      });
  }, [user, packs]);

  const counts = useMemo(() => {
    const next: Record<number, number> = {};
    frqs.forEach(({ title }) => {
      const unit = getFrqUnit(title);
      if (unit) next[unit] = (next[unit] ?? 0) + 1;
    });
    return next;
  }, [frqs]);

  const selectedCategory = FRQ_CATEGORIES.find((category) => category.unit === unit);
  const visibleFrqs = unit ? frqs.filter((frq) => getFrqUnit(frq.title) === unit) : [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link
        to={unit ? "/frq" : "/"}
        search={unit ? {} : undefined}
        className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {unit ? "返回大题分类" : "返回首页"}
      </Link>
      <div className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <SquarePen className="h-4 w-4" /> 大题刷题
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {selectedCategory ? `Unit ${selectedCategory.unit} · ${selectedCategory.nameZh}` : "选择大题分类"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {selectedCategory ? "选择一道大题单独作答，完成后按得分点评分。" : "和选择题一样，按 AP Unit 选择专项练习。"}
        </p>
        <Link
          to="/history"
          search={{ tab: "frq" }}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <History className="h-3.5 w-3.5" /> 历史记录
        </Link>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        selectedCategory ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {visibleFrqs.map((frq, index) => (
              <Card key={frq.id} className="flex h-full flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs font-semibold text-primary">第 {index + 1} 题</div>
                    <div className="text-xs text-muted-foreground">满分 {frq.max_score} 分</div>
                  </div>
                  <CardTitle className="text-base leading-snug">{frq.title ?? `FRQ ${index + 1}`}</CardTitle>
                  <CardDescription className="line-clamp-3 whitespace-pre-wrap leading-relaxed">
                    {frq.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link
                    to="/mock/$slug"
                    params={{ slug: "frq-pdf-practice" }}
                    search={{ unit: selectedCategory.unit, frq: frq.id }}
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    开始作答 <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FRQ_CATEGORIES.map((category) => {
            const count = counts[category.unit] ?? 0;
            return (
              <Link
                key={category.unit}
                to="/frq"
                search={{ unit: category.unit }}
                className={count === 0 ? "pointer-events-none opacity-55" : "group"}
              >
                <Card className="h-full transition-all group-hover:border-primary/50 group-hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-bold text-primary">
                        {category.unit}
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                    <CardTitle className="pt-3">Unit {category.unit} · {category.nameZh}</CardTitle>
                    <CardDescription>{category.nameEn}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm font-medium text-primary">
                    {count > 0 ? `${count} 道大题` : "暂无大题"}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>)
      )}

      {!selectedCategory && !loading && packs.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">大题合集（整卷练习）</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            按主题打包的 FRQ 整卷，逐题作答并由 AI 按官方得分点评分。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((p) => {
              const done = doneByPaper[p.id] ?? new Set<string>();
              const doneCount = p.frq_ids.filter((id) => done.has(id)).length;
              const finished = p.frq_count > 0 && doneCount >= p.frq_count;
              const nextFrq = p.frq_ids.find((id) => !done.has(id));
              const pct = p.frq_count ? Math.round((doneCount / p.frq_count) * 100) : 0;
              const state: "start" | "continue" | "done" = !user || doneCount === 0
                ? "start"
                : finished
                  ? "done"
                  : "continue";
              const label = state === "done" ? "重新作答" : state === "continue" ? "继续作答" : "开始作答";
              return (
                <Card key={p.id} className="transition-colors hover:border-primary/60">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold leading-snug">{p.title}</div>
                          {finished && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                              <CheckCircle2 className="h-3 w-3" /> 已完成
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.round(p.total_seconds / 60)} 分钟
                          </span>
                          <span>{p.frq_count} 道 FRQ</span>
                          {user && (
                            <span className={finished ? "text-emerald-600" : "text-primary"}>
                              已做 {doneCount}/{p.frq_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {user && p.frq_count > 0 && (
                      <div className="mt-3">
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {!user
                          ? "登录后可记录进度"
                          : state === "continue"
                            ? "上次未完成，从下一道开始"
                            : state === "done"
                              ? "全部完成，可重做任意题"
                              : "尚未开始"}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {user && state === "done" && (
                          <Link
                            to="/frq/review/$slug"
                            params={{ slug: p.slug }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                          >
                            <Trophy className="h-3.5 w-3.5" /> 评分回放
                          </Link>
                        )}
                        <Link
                          to="/mock/$slug"
                          params={{ slug: p.slug }}
                          search={state === "continue" && nextFrq ? { frq: nextFrq } : undefined}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {label}
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}