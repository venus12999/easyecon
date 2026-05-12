import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, FileText, Shuffle, ChevronRight, Loader2 } from "lucide-react";

export const Route = createFileRoute("/mock")({
  head: () => ({ meta: [{ title: "模考 · 真题卷库" }] }),
  component: MockLibrary,
});

type Paper = {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  total_seconds: number;
  description: string | null;
};

function MockLibrary() {
  const [papers, setPapers] = useState<Paper[] | null>(null);

  useEffect(() => {
    supabase
      .from("mock_papers")
      .select("id,slug,title,year,total_seconds,description")
      .order("sort_order", { ascending: true })
      .order("year", { ascending: false })
      .then(({ data }) => setPapers((data ?? []) as Paper[]));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-2">模考</h1>
        <p className="text-sm text-muted-foreground mb-8">
          选择一份真题卷按官方题目顺序作答，或用随机模考按 AP 比例抽题练习。
        </p>

        <h2 className="text-sm font-semibold text-muted-foreground mb-3">真题卷库</h2>
        {papers === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : papers.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              暂无真题卷，敬请期待。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3 mb-10">
            {papers.map((p) => (
              <Link
                key={p.id}
                to="/mock/$slug"
                params={{ slug: p.slug }}
                className="block group"
              >
                <Card className="transition-colors group-hover:border-primary/60">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{p.title}</div>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {p.description}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {Math.round(p.total_seconds / 60)} 分钟
                        </span>
                        {p.year && <span>{p.year} 年</span>}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <h2 className="text-sm font-semibold text-muted-foreground mb-3">其他模式</h2>
        <Link to="/mock/random" className="block group">
          <Card className="transition-colors group-hover:border-primary/60">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0">
                <Shuffle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">随机模考</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  从题库按 AP 官方单元比例随机抽 60 题
                </p>
                <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> 70 分钟
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
            </CardContent>
          </Card>
        </Link>
      </main>
    </div>
  );
}