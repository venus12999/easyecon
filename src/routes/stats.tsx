import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { BarChart3, Target, Flame, BookOpen, SquarePen, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Info, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "学习统计 · AP 微观经济" },
      { name: "description", content: "查看你的刷题数据、正确率趋势与各 Unit 表现。" },
    ],
  }),
  component: StatsPage,
});

type Attempt = {
  is_correct: boolean;
  knowledge_point_id: string;
  created_at: string;
};
type Kp = { id: string; unit: number; name_zh: string };
type Frq = { ai_score: number | null; ai_max_score: number | null; created_at: string };
type Mock = { total: number; correct: number; created_at: string };

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shortDay(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function StatsPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [kps, setKps] = useState<Kp[]>([]);
  const [frqs, setFrqs] = useState<Frq[]>([]);
  const [mocks, setMocks] = useState<Mock[]>([]);
  const [wrongCount, setWrongCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - 89);
      since.setHours(0, 0, 0, 0);
      const [aRes, kRes, fRes, mRes, wRes] = await Promise.all([
        supabase
          .from("answer_attempts")
          .select("is_correct,knowledge_point_id,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        supabase.from("knowledge_points").select("id,unit,name_zh"),
        supabase
          .from("frq_submissions")
          .select("ai_score,ai_max_score,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("mock_attempts")
          .select("total,correct,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("wrong_questions")
          .select("question_id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);
      setAttempts((aRes.data ?? []) as Attempt[]);
      setKps((kRes.data ?? []) as Kp[]);
      setFrqs((fRes.data ?? []) as Frq[]);
      setMocks((mRes.data ?? []) as Mock[]);
      setWrongCount(wRes.count ?? 0);
      setLoading(false);
    })();
  }, [user]);

  const kpMap = useMemo(() => {
    const m = new Map<string, Kp>();
    kps.forEach((k) => m.set(k.id, k));
    return m;
  }, [kps]);

  // 总览
  const total = attempts.length;
  const correct = attempts.filter((a) => a.is_correct).length;
  const rate = total ? Math.round((correct / total) * 100) : 0;

  // 今日 / 本周
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
  const todayAttempts = attempts.filter((a) => new Date(a.created_at) >= startOfDay);
  const weekAttempts = attempts.filter((a) => new Date(a.created_at) >= startOfWeek);
  const todayCount = todayAttempts.length;
  const weekCount = weekAttempts.length;
  const weekRate = weekAttempts.length
    ? Math.round((weekAttempts.filter((a) => a.is_correct).length / weekAttempts.length) * 100)
    : null;

  // 连续打卡天数（从今天向前数）
  const daySet = useMemo(() => {
    const s = new Set<string>();
    attempts.forEach((a) => s.add(dayKey(new Date(a.created_at))));
    return s;
  }, [attempts]);
  let streak = 0;
  {
    const cur = new Date(startOfDay);
    // 今天没做也允许从昨天起算
    if (!daySet.has(dayKey(cur))) cur.setDate(cur.getDate() - 1);
    while (daySet.has(dayKey(cur))) {
      streak += 1;
      cur.setDate(cur.getDate() - 1);
    }
  }

  // 最近 14 天趋势
  const trend14 = useMemo(() => {
    const arr: { date: string; 答题: number; 正确: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      const k = dayKey(d);
      const dayItems = attempts.filter((a) => dayKey(new Date(a.created_at)) === k);
      arr.push({
        date: shortDay(d),
        答题: dayItems.length,
        正确: dayItems.filter((a) => a.is_correct).length,
      });
    }
    return arr;
  }, [attempts, startOfDay]);

  // 各 Unit 正确率
  const unitRates = useMemo(() => {
    const acc: Record<number, { t: number; c: number }> = {};
    attempts.forEach((a) => {
      const u = kpMap.get(a.knowledge_point_id)?.unit;
      if (u == null) return;
      acc[u] ??= { t: 0, c: 0 };
      acc[u].t += 1;
      if (a.is_correct) acc[u].c += 1;
    });
    return Object.entries(acc)
      .map(([u, v]) => ({ unit: `U${u}`, 正确率: Math.round((v.c / v.t) * 100), 题数: v.t }))
      .sort((a, b) => a.unit.localeCompare(b.unit));
  }, [attempts, kpMap]);

  // 各知识点表现
  const kpRows = useMemo(() => {
    const acc: Record<string, { t: number; c: number }> = {};
    attempts.forEach((a) => {
      acc[a.knowledge_point_id] ??= { t: 0, c: 0 };
      acc[a.knowledge_point_id].t += 1;
      if (a.is_correct) acc[a.knowledge_point_id].c += 1;
    });
    return Object.entries(acc)
      .map(([id, v]) => ({
        id,
        name: kpMap.get(id)?.name_zh ?? "未知知识点",
        unit: kpMap.get(id)?.unit ?? 0,
        total: v.t,
        correct: v.c,
        rate: Math.round((v.c / v.t) * 100),
      }))
      .sort((a, b) => b.total - a.total);
  }, [attempts, kpMap]);

  // FRQ
  const frqGraded = frqs.filter((f) => f.ai_score != null && f.ai_max_score);
  const frqAvgPct = frqGraded.length
    ? Math.round(
        (frqGraded.reduce((s, f) => s + (f.ai_score! / f.ai_max_score!), 0) / frqGraded.length) * 100,
      )
    : null;

  // 模拟卷
  const mockBest = mocks.length
    ? Math.max(...mocks.map((m) => (m.total ? Math.round((m.correct / m.total) * 100) : 0)))
    : null;

  if (authLoading) {
    return <main className="mx-auto max-w-6xl px-4 py-10">加载中…</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <BarChart3 className="h-10 w-10 text-primary" />
            <h1 className="text-2xl font-bold">学习统计</h1>
            <p className="text-muted-foreground">登录后查看你的刷题数据、正确率趋势与各 Unit 表现。</p>
            <Link
              to="/auth"
              className="mt-2 inline-flex items-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              登录 / 注册
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" /> 学习统计
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">你的刷题数据、趋势与薄弱知识点一览。</p>
        </div>
        <Link
          to="/wrong"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          去错题本 <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      {/* KPI */}
      <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<BookOpen className="h-4 w-4" />} label="累计答题" value={total} sub={`今日 +${todayCount}`} />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="总体正确率"
          value={total ? `${rate}%` : "—"}
          sub={`正确 ${correct} / 错 ${total - correct}`}
        />
        <KpiCard
          icon={<Flame className="h-4 w-4 text-orange-500" />}
          label="连续打卡"
          value={`${streak} 天`}
          sub={weekRate != null ? `本周正确率 ${weekRate}%` : "本周尚未答题"}
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4 text-rose-500" />}
          label="错题本"
          value={wrongCount}
          sub={`本周答题 ${weekCount}`}
        />
      </section>

      {/* 趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近 14 天答题趋势</CardTitle>
          <CardDescription>每日答题数与正确题数</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-56 animate-pulse rounded-md bg-muted" />
          ) : trend14.every((d) => d.答题 === 0) ? (
            <EmptyHint text="最近 14 天还没有答题记录" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend14} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="答题" stroke="hsl(var(--primary))" fill="url(#g1)" />
                  <Area type="monotone" dataKey="正确" stroke="#10b981" fill="url(#g2)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unit 正确率 + 大题/模考 */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">各 Unit 正确率</CardTitle>
            <CardDescription>按知识点 Unit 聚合</CardDescription>
          </CardHeader>
          <CardContent>
            {unitRates.length === 0 ? (
              <EmptyHint text="还没有数据，去刷几道题吧" />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={unitRates} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="unit" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={28} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(v: number, _n, p) => [`${v}%`, `正确率（共 ${p.payload.题数} 题）`]}
                    />
                    <Bar dataKey="正确率" radius={[6, 6, 0, 0]}>
                      {unitRates.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.正确率 >= 80 ? "#10b981" : d.正确率 >= 60 ? "hsl(var(--primary))" : "#f43f5e"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">大题与模考</CardTitle>
            <CardDescription>FRQ 与套卷表现</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatRow
              icon={<SquarePen className="h-4 w-4 text-primary" />}
              label="FRQ 提交"
              value={`${frqs.length} 份`}
              sub={frqAvgPct != null ? `AI 平均得分率 ${frqAvgPct}%` : "暂无已评分提交"}
            />
            <StatRow
              icon={<Target className="h-4 w-4 text-primary" />}
              label="模拟卷次数"
              value={`${mocks.length} 次`}
              sub={mockBest != null ? `最高正确率 ${mockBest}%` : "尚未完成模拟"}
            />
          </CardContent>
        </Card>
      </section>

      {/* 知识点表现 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">知识点表现</CardTitle>
          <CardDescription>按答题数量排序，正确率越低越值得复习</CardDescription>
        </CardHeader>
        <CardContent>
          {kpRows.length === 0 ? (
            <EmptyHint text="还没有知识点数据" />
          ) : (
            <div className="divide-y">
              {kpRows.slice(0, 12).map((r) => (
                <div key={r.id} className="py-2.5 flex items-center gap-3">
                  <Badge variant="outline" className="shrink-0">U{r.unit}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${
                          r.rate >= 80 ? "bg-emerald-500" : r.rate >= 60 ? "bg-primary" : "bg-rose-500"
                        }`}
                        style={{ width: `${r.rate}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0 w-24">
                    <div className="text-sm font-semibold">{r.rate}%</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.correct}/{r.total}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-card p-3">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-base font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}