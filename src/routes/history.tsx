import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, History, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "历史记录 · 刷题与模考成绩 | EasyEcon" },
      { name: "description", content: "查看选择题、大题与模拟考试的历史成绩记录，包含每一轮的正确率、得分与用时。" },
      { property: "og:title", content: "历史记录 · 刷题与模考成绩" },
      { property: "og:description", content: "回看每一轮选择题、大题与模考的成绩变化。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: "mcq" | "frq" | "mock" } => {
    const tab = search.tab;
    return { tab: tab === "frq" || tab === "mock" ? tab : "mcq" };
  },
  component: HistoryPage;
});

type McqRound = {
  key: string;
  kpName: string;
  unit: number | null;
  attempts: number;
  correct: number;
  finishedAt: string;
  current: boolean;
};

type FrqRound = {
  key: string;
  paperTitle: string;
  count: number;
  score: number;
  maxScore: number;
  finishedAt: string;
  current: boolean;
};

type MockRow = {
  id: string;
  paper_title: string | null;
  paper_slug: string | null;
  mode: string | null;
  total: number;
  correct: number;
  duration_seconds: number;
  created_at: string;
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString("zh-CN", { hour12: false });
}

function HistoryPage() {
  const { tab } = Route.useSearch();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mcq, setMcq] = useState<McqRound[]>([]);
  const [frq, setFrq] = useState<FrqRound[]>([]);
  const [mocks, setMocks] = useState<MockRow[]>([]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      const [attemptsRes, kpRes, subRes, paperRes, frqRes, mockRes] = await Promise.all([
        supabase
          .from("answer_attempts")
          .select("knowledge_point_id,is_correct,archived_at,created_at")
          .eq("user_id", user.id)
          .eq("mode", "practice")
          .order("created_at", { ascending: true }),
        supabase.from("knowledge_points").select("id,unit,name_zh"),
        supabase
          .from("frq_submissions")
          .select("paper_id,frq_id,ai_score,ai_max_score,archived_at,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        supabase.from("mock_papers").select("id,title"),
        supabase.from("paper_frqs").select("id,max_score"),
        supabase
          .from("mock_attempts")
          .select("id,paper_title,paper_slug,mode,total,correct,duration_seconds,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const kpMap = new Map(((kpRes.data ?? []) as { id: string; unit: number; name_zh: string }[]).map((k) => [k.id, k]));
      const mcqGroups = new Map<string, McqRound>();
      ((attemptsRes.data ?? []) as {
        knowledge_point_id: string;
        is_correct: boolean;
        archived_at: string | null;
        created_at: string;
      }[]).forEach((r) => {
        const kp = kpMap.get(r.knowledge_point_id);
        const key = `${r.knowledge_point_id}:${r.archived_at ?? "current"}`;
        const g = mcqGroups.get(key) ?? {
          key,
          kpName: kp?.name_zh ?? "未知知识点",
          unit: kp?.unit ?? null,
          attempts: 0,
          correct: 0,
          finishedAt: r.archived_at ?? r.created_at,
          current: !r.archived_at,
        };
        g.attempts += 1;
        if (r.is_correct) g.correct += 1;
        if (!r.archived_at) g.finishedAt = r.created_at;
        mcqGroups.set(key, g);
      });
      setMcq(
        Array.from(mcqGroups.values()).sort(
          (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime(),
        ),
      );

      const paperMap = new Map(((paperRes.data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
      const frqMaxMap = new Map(((frqRes.data ?? []) as { id: string; max_score: number }[]).map((f) => [f.id, f.max_score]));
      const frqGroups = new Map<string, FrqRound>();
      ((subRes.data ?? []) as {
        paper_id: string;
        frq_id: string;
        ai_score: number | null;
        ai_max_score: number | null;
        archived_at: string | null;
        created_at: string;
      }[]).forEach((r) => {
        const key = `${r.paper_id}:${r.archived_at ?? "current"}`;
        const g = frqGroups.get(key) ?? {
          key,
          paperTitle: paperMap.get(r.paper_id) ?? "大题练习",
          count: 0,
          score: 0,
          maxScore: 0,
          finishedAt: r.archived_at ?? r.created_at,
          current: !r.archived_at,
        };
        g.count += 1;
        g.score += r.ai_score ?? 0;
        g.maxScore += r.ai_max_score ?? frqMaxMap.get(r.frq_id) ?? 0;
        if (!r.archived_at) g.finishedAt = r.created_at;
        frqGroups.set(key, g);
      });
      setFrq(
        Array.from(frqGroups.values()).sort(
          (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime(),
        ),
      );

      setMocks((mockRes.data ?? []) as MockRow[]);
      setLoading(false);
    })();
  }, [user]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回首页
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl">
        <History className="h-5 w-5 text-primary" /> 历史记录
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">每次清空重做前的成绩都会保留在这里。</p>

      {!user ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            历史记录需要登录后才能保存。
            <Link to="/auth" className="ml-1 text-primary hover:underline">立即登录 / 注册</Link>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs defaultValue={tab ?? "mcq"} className="mt-5">
          <TabsList>
            <TabsTrigger value="mcq">选择题</TabsTrigger>
            <TabsTrigger value="frq">大题</TabsTrigger>
            <TabsTrigger value="mock">模拟考试</TabsTrigger>
          </TabsList>

          <TabsContent value="mcq" className="mt-4 space-y-2.5">
            {mcq.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">暂无选择题记录。</CardContent></Card>
            ) : (
              mcq.map((r) => (
                <Card key={r.key}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {r.unit != null ? `Unit ${r.unit} · ` : ""}{r.kpName}
                        {r.current && <span className="ml-2 rounded-pill bg-primary/10 px-2 py-0.5 text-[10px] text-primary">进行中</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{fmt(r.finishedAt)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-primary">
                        {r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) : 0}%
                      </div>
                      <div className="text-xs text-muted-foreground">{r.correct}/{r.attempts} 题</div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="frq" className="mt-4 space-y-2.5">
            {frq.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">暂无大题记录。</CardContent></Card>
            ) : (
              frq.map((r) => (
                <Card key={r.key}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {r.paperTitle}
                        {r.current && <span className="ml-2 rounded-pill bg-primary/10 px-2 py-0.5 text-[10px] text-primary">进行中</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{fmt(r.finishedAt)} · {r.count} 道</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-primary">{r.score}/{r.maxScore || "—"}</div>
                      <div className="text-xs text-muted-foreground">AI 评分</div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="mock" className="mt-4 space-y-2.5">
            {mocks.length === 0 ? (
              <Card><CardContent className="p-5 text-sm text-muted-foreground">暂无模考记录。</CardContent></Card>
            ) : (
              mocks.map((m) => (
                <Card key={m.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {m.paper_title ?? (m.mode === "random" ? "随机模考" : "模拟考试")}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmt(m.created_at)} · 用时 {Math.round(m.duration_seconds / 60)} 分钟
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-primary">
                        {m.total > 0 ? Math.round((m.correct / m.total) * 100) : 0}%
                      </div>
                      <div className="text-xs text-muted-foreground">{m.correct}/{m.total} 题</div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}