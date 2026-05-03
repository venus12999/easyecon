import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getProgress, type ProgressMap } from "@/lib/storage";
import { ChevronRight, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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

type Counts = Record<
  string,
  { basic: number; application: number; pitfall: number; total: number; draft: number }
>;

type KpProgressInfo = {
  done: number; // 当前轮已做题数
  total: number;
  round: number; // 第几轮（1 起）
};

function Index() {
  const [kps, setKps] = useState<Kp[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loading, setLoading] = useState(true);
  const [unit, setUnit] = useState<number | null>(null);
  const { user } = useAuth();
  const [kpProgress, setKpProgress] = useState<Record<string, KpProgressInfo>>({});
  const [stats, setStats] = useState<{ today: number; rate: number | null; totalAttempts: number }>({
    today: 0,
    rate: null,
    totalAttempts: 0,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [todayRes, totalRes, correctRes] = await Promise.all([
        supabase
          .from("answer_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", startOfDay.toISOString()),
        supabase
          .from("answer_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("answer_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_correct", true),
      ]);
      const today = todayRes.count ?? 0;
      const total = totalRes.count ?? 0;
      const correct = correctRes.count ?? 0;
      setStats({ today, totalAttempts: total, rate: total ? Math.round((correct / total) * 100) : null });
    })();
  }, [user]);

  useEffect(() => {
    setProgress(getProgress());
    (async () => {
      const { data: kpData } = await supabase
        .from("knowledge_points")
        .select("*")
        .order("unit")
        .order("sort_order");
      const { data: qData } = await supabase
        .from("questions")
        .select("knowledge_point_id,type,status");
      const c: Counts = {};
      (qData ?? []).forEach((q) => {
        const k = q.knowledge_point_id as string;
        if (!c[k]) c[k] = { basic: 0, application: 0, pitfall: 0, total: 0, draft: 0 };
        if (q.status === "published") {
          c[k][q.type as "basic" | "application" | "pitfall"] += 1;
          c[k].total += 1;
        } else {
          c[k].draft += 1;
        }
      });
      const kpList = (kpData ?? []) as Kp[];
      setKps(kpList);
      const firstUnit = kpList[0]?.unit ?? null;
      setUnit((cur) => cur ?? firstUnit);
      setCounts(c);
      setLoading(false);
    })();
  }, []);

  // 计算每个知识点的「当前轮进度」：按时间顺序遍历答题记录，
  // 每当本轮覆盖该知识点全部题目后开启新一轮。
  useEffect(() => {
    if (!user) {
      setKpProgress({});
      return;
    }
    if (Object.keys(counts).length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("answer_attempts")
        .select("knowledge_point_id,question_id,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      const grouped: Record<string, { qid: string }[]> = {};
      (data ?? []).forEach((r) => {
        const k = r.knowledge_point_id as string;
        (grouped[k] ??= []).push({ qid: r.question_id as string });
      });
      const next: Record<string, KpProgressInfo> = {};
      for (const [kpId, rows] of Object.entries(grouped)) {
        const total = counts[kpId]?.total ?? 0;
        if (total === 0) continue;
        let round = 1;
        let seen = new Set<string>();
        for (const r of rows) {
          seen.add(r.qid);
          if (seen.size >= total) {
            round += 1;
            seen = new Set();
          }
        }
        // 若刚好整轮结束，显示已完成的整轮
        const done = seen.size === 0 && round > 1 ? total : seen.size;
        const displayRound = seen.size === 0 && round > 1 ? round - 1 : round;
        next[kpId] = { done, total, round: displayRound };
      }
      setKpProgress(next);
    })();
  }, [user, counts]);

  const allUnits = Array.from(new Set(kps.map((k) => k.unit))).sort((a, b) => a - b);
  const visibleKps = unit == null ? kps : kps.filter((k) => k.unit === unit);

  return (
    <div className="min-h-screen bg-background">
      
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-8">
          <div className="flex items-center gap-2 text-xs text-primary font-medium mb-2">
            <Sparkles className="h-3.5 w-3.5" /> AP Microeconomics
          </div>
          <h1 className="text-3xl font-bold tracking-tight">选一个知识点开始刷</h1>
          <p className="mt-2 text-muted-foreground">
            英文题干 + 中文解析 + 术语悬停翻译。专为中国 AP 学生设计。
          </p>
        </section>

        {user && (
          <section className="grid gap-3 sm:grid-cols-3 mb-6">
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground">今日已完成</div>
                <div className="mt-1 text-3xl font-bold text-primary">{stats.today}</div>
                <div className="mt-1 text-xs text-muted-foreground">累计 {stats.totalAttempts} 题</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground">总正确率</div>
                <div className="mt-1 text-3xl font-bold text-success">
                  {stats.rate !== null ? `${stats.rate}%` : "—"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">基于全部答题</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground">账号</div>
                <div className="mt-1 text-sm font-semibold truncate" title={user.email ?? ""}>
                  {user.email}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">数据自动云端保存</div>
              </CardContent>
            </Card>
          </section>
        )}
        {!user && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="p-5 flex items-center justify-between gap-4">
              <div className="text-sm">
                <div className="font-semibold">注册后所有进度自动云端保存</div>
                <div className="text-muted-foreground text-xs mt-1">
                  每个邮箱仅可注册一次。当前为游客模式。
                </div>
              </div>
              <Link
                to="/auth"
                className="shrink-0 inline-flex items-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
              >
                登录 / 注册
              </Link>
            </CardContent>
          </Card>
        )}

        {allUnits.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {allUnits.map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  unit === u
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-accent"
                }`}
              >
                Unit {u}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleKps.map((kp) => {
              const c = counts[kp.id] ?? { basic: 0, application: 0, pitfall: 0, total: 0, draft: 0 };
              const n = c.total;
              const kpInfo = kpProgress[kp.id];
              return (
                <Link
                  key={kp.id}
                  to="/practice/$slug"
                  params={{ slug: kp.slug }}
                  search={{}}
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
                          {n > 0
                            ? `${n} 题`
                            : c.draft > 0
                              ? `暂无题目（${c.draft} 道待审核）`
                              : "暂无题目"}
                        </span>
                        {kpInfo && n > 0 ? (
                          <span className="text-primary font-medium">
                            {kpInfo.round > 1 ? `第${kpInfo.round}轮 ` : ""}
                            {kpInfo.done}/{kpInfo.total}
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
