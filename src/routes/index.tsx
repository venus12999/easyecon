import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ChevronRight,
  Sparkles,
  BookOpen,
  Target,
  Bookmark,
  XCircle,
  BarChart3,
  Library,
  ArrowRight,
  Flame,
  Check,
} from "lucide-react";
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

function QuickCard({
  to,
  icon,
  iconBg,
  title,
  subtitle,
  accent,
  accentText,
}: {
  to: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  accent: string;
  accentText: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border bg-card p-4 hover:shadow-md hover:border-primary/40 transition-all flex flex-col gap-3"
    >
      <div className={`h-9 w-9 rounded-xl ${iconBg} flex items-center justify-center`}>{icon}</div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <div className={`flex items-center justify-between text-xs font-medium ${accent}`}>
        <span>{accentText}</span>
        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
      </div>
    </Link>
  );
}

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
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [kps, setKps] = useState<Kp[]>([]);
  const [counts, setCounts] = useState<Counts>({});
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
    setCurrentDate(new Date());
  }, []);

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

  // 问候语
  const hour = currentDate?.getHours();
  const greeting = hour == null ? "你好" : hour < 6 ? "凌晨好" : hour < 12 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const displayName = user?.email ? user.email.split("@")[0] : "同学";

  // 本周打卡（基于 stats.today 这种只能粗略；这里用一个简单展示）
  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];
  const todayIdx = currentDate ? (currentDate.getDay() + 6) % 7 : -1; // 周一=0

  // 选一个有题目的 KP，用于 Practice 大卡的副标题与跳转
  const firstKpWithQuestions = kps.find((k) => (counts[k.id]?.total ?? 0) > 0) ?? kps[0];

  return (
    <div className="min-h-screen bg-background">
      
      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* 顶部问候 */}
        <section className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {greeting}，{displayName} <span className="inline-block">👋</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              {user
                ? stats.today > 0
                  ? `今天已完成 ${stats.today} 题，继续保持！`
                  : "今天还没开始刷题，挑一张卡片出发吧。"
                : "登录后可云端同步进度。"}
            </p>
          </div>
          {user && (
            <div className="rounded-xl bg-card border px-4 py-2.5 flex items-center gap-2 shadow-sm">
              <BarChart3 className="h-5 w-5 text-primary" />
              <div className="leading-tight">
                <div className="text-xs text-muted-foreground">正确率</div>
                <div className="text-base font-bold">
                  {stats.rate !== null ? `${stats.rate}%` : "—"}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 双大卡 */}
        <section className="grid gap-4 md:grid-cols-2 mb-5">
          <Link
            to={firstKpWithQuestions ? "/practice/$slug" : "/"}
            params={firstKpWithQuestions ? { slug: firstKpWithQuestions.slug } : undefined as never}
            search={{} as never}
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[#bcd9f5] via-[#c9e4f5] to-[#e7f1fb] p-6 min-h-[230px] flex flex-col justify-between text-[#16335c] shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-2xl bg-white/60 backdrop-blur flex items-center justify-center shadow-sm">
                <BookOpen className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 opacity-70 group-hover:translate-x-1 transition-transform" />
            </div>
            <div>
              <div className="text-2xl font-bold">刷题练习</div>
              <div className="text-sm opacity-80 mt-1">
                {firstKpWithQuestions
                  ? `Unit ${firstKpWithQuestions.unit} · ${firstKpWithQuestions.name_zh}`
                  : "选择知识点开始训练"}
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/60 backdrop-blur px-4 py-2 text-sm font-medium">
                继续上次的进度
              </div>
            </div>
          </Link>

          <Link
            to="/mock"
            className="group relative overflow-hidden rounded-2xl p-6 min-h-[230px] flex flex-col justify-between text-white shadow-sm hover:shadow-md transition-shadow"
            style={{ background: "linear-gradient(135deg,#27406b 0%,#3b5f95 60%,#5d82b8 100%)" }}
          >
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center">
                <Target className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 opacity-80 group-hover:translate-x-1 transition-transform" />
            </div>
            <div>
              <div className="text-2xl font-bold">模拟考试</div>
              <div className="text-sm opacity-80 mt-1">真题套卷 · MCQ + FRQ</div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-4 py-2 text-sm font-medium">
                开始考试
              </div>
            </div>
          </Link>
        </section>

        {/* 四张小卡 */}
        <section className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
          <QuickCard
            to="/wrong"
            icon={<Bookmark className="h-5 w-5 text-amber-500" />}
            iconBg="bg-amber-50"
            title="收藏"
            subtitle="标记题目复习"
            accent="text-amber-600"
            accentText="查看"
          />
          <QuickCard
            to="/wrong"
            icon={<XCircle className="h-5 w-5 text-rose-500" />}
            iconBg="bg-rose-50"
            title="错题本"
            subtitle="复盘并提升"
            accent="text-rose-600"
            accentText="去复习"
          />
          <QuickCard
            to="/"
            icon={<BarChart3 className="h-5 w-5 text-emerald-500" />}
            iconBg="bg-emerald-50"
            title="统计"
            subtitle="查看你的进度"
            accent="text-emerald-600"
            accentText={stats.rate !== null ? `${stats.rate}% 正确率` : "暂无数据"}
          />
          <QuickCard
            to="/terms"
            icon={<Library className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title="术语表"
            subtitle="中英对照速查"
            accent="text-primary"
            accentText="打开"
          />
        </section>

        {/* 打卡 */}
        <section className="mb-8">
          <div className="rounded-2xl border bg-card p-4 flex items-center gap-5">
            <div className="flex items-center gap-3 pr-4 border-r">
              <div className="text-3xl font-bold">{stats.today > 0 ? "+1" : "0"}</div>
              <div>
                <div className="text-sm font-semibold flex items-center gap-1">
                  今日打卡 <Flame className="h-4 w-4 text-orange-500" />
                </div>
                <div className="text-xs text-muted-foreground">坚持每天一点点</div>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-7 gap-1.5 text-center">
              {weekDays.map((d, i) => {
                const done = i < todayIdx || (i === todayIdx && stats.today > 0);
                const isToday = i === todayIdx;
                return (
                  <div key={d} className="flex flex-col items-center gap-1">
                    <div className="text-[11px] text-muted-foreground">{d}</div>
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs ${
                        done
                          ? "bg-primary text-primary-foreground"
                          : isToday
                            ? "border-2 border-primary text-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

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

        {/* 知识点列表 */}
        <section className="mb-3 flex items-center gap-2 text-xs text-primary font-medium">
          <Sparkles className="h-3.5 w-3.5" /> 知识点 · 选一个开始
        </section>

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
