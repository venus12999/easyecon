import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getProgress, type ProgressMap } from "@/lib/storage";
import { ChevronRight, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AP 微观经济刷题 — 中国学生友好的英文 MCQ 训练" },
      { name: "description", content: "针对中国 AP 学生的微观经济选择题训练，含中英文术语对照、官方风格解析与 AI 追问。" },
      { property: "og:title", content: "AP 微观经济刷题平台" },
      { property: "og:description", content: "Unit 2 供需完整刷题闭环，术语中英对照 + AI 追问助手。" },
    ],
  }),
  component: Index,
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

type Counts = Record<string, { basic: number; application: number; pitfall: number; total: number }>;

function Index() {
  const [kps, setKps] = useState<Kp[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [progress, setProgress] = useState<ProgressMap>({});
  const [tab, setTab] = useState<"basic" | "application" | "pitfall">("basic");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setProgress(getProgress());
    (async () => {
      const { data: kpData } = await supabase
        .from("knowledge_points")
        .select("*")
        .eq("unit", 2)
        .order("sort_order");
      const { data: qData } = await supabase
        .from("questions")
        .select("knowledge_point_id,type")
        .eq("status", "published");
      const c: Counts = {};
      (qData ?? []).forEach((q) => {
        const k = q.knowledge_point_id as string;
        if (!c[k]) c[k] = { basic: 0, application: 0, pitfall: 0, total: 0 };
        c[k][q.type as "basic" | "application" | "pitfall"] += 1;
        c[k].total += 1;
      });
      setKps((kpData ?? []) as Kp[]);
      setCounts(c);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-8">
          <div className="flex items-center gap-2 text-xs text-primary font-medium mb-2">
            <Sparkles className="h-3.5 w-3.5" /> Phase 1 · Unit 2 Supply & Demand
          </div>
          <h1 className="text-3xl font-bold tracking-tight">选一个知识点开始刷</h1>
          <p className="mt-2 text-muted-foreground">
            英文题干 + 中文解析 + 术语悬停翻译。专为中国 AP 学生设计。
          </p>
        </section>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-6">
          <TabsList>
            <TabsTrigger value="basic">基础题（概念）</TabsTrigger>
            <TabsTrigger value="application">应用题（情境）</TabsTrigger>
            <TabsTrigger value="pitfall">易错题（常见坑）</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kps.map((kp) => {
              const c = counts[kp.id] ?? { basic: 0, application: 0, pitfall: 0, total: 0 };
              const n = c[tab];
              const p = progress[kp.id];
              const acc = p && p.attempts > 0 ? Math.round((p.correct / p.attempts) * 100) : null;
              return (
                <Link
                  key={kp.id}
                  to="/practice/$slug"
                  params={{ slug: kp.slug }}
                  search={{ type: tab }}
                  className="group"
                >
                  <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{kp.name_zh}</CardTitle>
                          <CardDescription className="mt-0.5 text-xs font-mono">
                            {kp.name_en}
                          </CardDescription>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {kp.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {kp.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {n > 0 ? `${n} 题` : "暂无题目"}
                        </span>
                        {acc !== null ? (
                          <span className="text-primary font-medium">
                            正确率 {acc}% · {p!.attempts} 次
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未开始</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
