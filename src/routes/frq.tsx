import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, SquarePen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FRQ_CATEGORIES, getFrqUnit } from "@/lib/frq-categories";

export const Route = createFileRoute("/frq")({
  head: () => ({
    meta: [
      { title: "AP 微观经济大题分类刷题" },
      { name: "description", content: "按 AP 微观经济 Unit 分类练习 FRQ 大题，并按得分点获得评分。" },
    ],
  }),
  component: FrqCategoriesPage,
});

function FrqCategoriesPage() {
  const [titles, setTitles] = useState<Array<{ title: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data: paper } = await supabase
        .from("mock_papers")
        .select("id")
        .eq("slug", "frq-pdf-practice")
        .maybeSingle();
      if (paper) {
        const { data } = await supabase.from("paper_frqs").select("title").eq("paper_id", paper.id);
        setTitles(data ?? []);
      }
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(() => {
    const next: Record<number, number> = {};
    titles.forEach(({ title }) => {
      const unit = getFrqUnit(title);
      if (unit) next[unit] = (next[unit] ?? 0) + 1;
    });
    return next;
  }, [titles]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link to="/" className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回刷题
      </Link>
      <div className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <SquarePen className="h-4 w-4" /> 大题刷题
        </div>
        <h1 className="text-3xl font-bold tracking-tight">选择大题分类</h1>
        <p className="mt-2 text-muted-foreground">和选择题一样，按 AP Unit 选择专项练习。</p>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FRQ_CATEGORIES.map((category) => {
            const count = counts[category.unit] ?? 0;
            return (
              <Link
                key={category.unit}
                to="/mock/$slug"
                params={{ slug: "frq-pdf-practice" }}
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
        </div>
      )}
    </main>
  );
}