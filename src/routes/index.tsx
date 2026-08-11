import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ChevronRight,
  Sparkles,
  BookOpen,
  Target,
  XCircle,
  BarChart3,
  Library,
  ArrowRight,
  SquarePen,
  GraduationCap,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { computeCoachSuggestion, type CoachSuggestion } from "@/lib/mascot-coach";
import { getCompanion, COMPANION_KEY, type CompanionId } from "@/lib/mascot-lines";


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


function Index() {
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [kps, setKps] = useState<Kp[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [coach, setCoach] = useState<CoachSuggestion | null>(null);
  const [coachCompanion, setCoachCompanion] = useState<CompanionId>("sarah");
  const [stats, setStats] = useState<{ today: number; rate: number | null; totalAttempts: number }>({
    today: 0,
    rate: null,
    totalAttempts: 0,
  });

  useEffect(() => {
    setCurrentDate(new Date());
  }, []);

  useEffect(() => {
    if (!user) { setCoach(null); return; }
    try {
      const stored = (localStorage.getItem(COMPANION_KEY) as CompanionId | null) ?? "sarah";
      setCoachCompanion(stored);
    } catch {}
    void computeCoachSuggestion(user.id).then(setCoach);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDisplayName(null);
      return;
    }
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name?.trim() || null));
  }, [user]);

  useEffect(() => {
    if (!user) {
      setStats({ today: 0, rate: null, totalAttempts: 0 });
      return;
    }
    (async () => {
      const now = new Date();
      const startOfDay = new Date(now);
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
        .select("knowledge_point_id,type,status")
        .eq("exclude_from_pool", false);
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
      setCounts(c);
      setLoading(false);
    })();
  }, []);

  // 问候语
  const hour = currentDate?.getHours();
  const greeting = hour == null ? "你好" : hour < 6 ? "凌晨好" : hour < 12 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const userLabel = displayName ?? (user?.email ? user.email.split("@")[0] : "同学");

  // 选一个有题目的 KP，用于 Practice 大卡的副标题与跳转
  const firstKpWithQuestions = kps.find((k) => (counts[k.id]?.total ?? 0) > 0) ?? kps[0];

  return (
    <div className="min-h-screen">
      
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-8">
        {/* 顶部问候 */}
        <section className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting}，{userLabel} <span className="inline-block">👋</span>
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

        {user && coach && (
          <section className="mb-5">
            <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <img src={getCompanion(coachCompanion).image} alt="" className="h-10 w-10 shrink-0" style={{ imageRendering: "pixelated" }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-primary">{getCompanion(coachCompanion).name} 的提醒</div>
                <div className="mt-0.5 text-sm text-foreground">{coach.message}</div>
              </div>
              {coach.actionTo && coach.actionLabel && (
                <button
                  type="button"
                  onClick={() => {
                    if (coach.actionParams) {
                      navigate({ to: coach.actionTo!, params: coach.actionParams as never });
                    } else {
                      navigate({ to: coach.actionTo! });
                    }
                  }}
                  className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  {coach.actionLabel}
                </button>
              )}
            </div>
          </section>
        )}

        {/* 题型选择 */}
        <section className="mb-3 flex items-center gap-2 text-xs text-primary font-medium">
          <Sparkles className="h-3.5 w-3.5" /> 选择刷题类型
        </section>
        <section className="grid gap-4 md:grid-cols-3 mb-5">
          <Link
            to="/practice"
            className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[#bcd9f5] via-[#c9e4f5] to-[#e7f1fb] p-6 min-h-[230px] flex flex-col justify-between text-[#16335c] shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-2xl bg-white/60 backdrop-blur flex items-center justify-center shadow-sm">
                <BookOpen className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 opacity-70 group-hover:translate-x-1 transition-transform" />
            </div>
            <div>
              <div className="text-2xl font-bold">选择题</div>
              <div className="text-sm opacity-80 mt-1">
                {firstKpWithQuestions
                  ? `Unit ${firstKpWithQuestions.unit} · ${firstKpWithQuestions.name_zh}`
                  : "选择知识点开始训练"}
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/60 backdrop-blur px-4 py-2 text-sm font-medium">
                开始刷选择题
              </div>
            </div>
          </Link>

          <Link
            to="/frq"
            className="group relative overflow-hidden rounded-2xl border bg-primary/10 p-6 min-h-[230px] flex flex-col justify-between text-foreground shadow-sm hover:shadow-md hover:border-primary/40 transition-all"
          >
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-2xl bg-primary/15 flex items-center justify-center">
                <SquarePen className="h-6 w-6 text-primary" />
              </div>
              <ArrowRight className="h-5 w-5 text-primary group-hover:translate-x-1 transition-transform" />
            </div>
            <div>
              <div className="text-2xl font-bold">大题</div>
              <div className="text-sm text-muted-foreground mt-1">按 Unit 分类 · 按得分点评分</div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/15 px-4 py-2 text-sm font-medium text-primary">
                开始刷大题
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

        {/* 五分大神带你飞 */}
        <section className="mb-5">
          <Link
            to="/tutor"
            className="group relative overflow-hidden rounded-2xl p-6 flex items-center justify-between gap-4 text-white shadow-sm hover:shadow-md transition-shadow"
            style={{ background: "linear-gradient(135deg,#1c56c4 0%,#2f7fe0 55%,#69aef0 100%)" }}
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                <GraduationCap className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xl font-bold">五分大神带你飞</div>
                <div className="text-sm opacity-90 mt-0.5">订阅 5 分学长学姐的一对一线上辅导课</div>
              </div>
            </div>
            <div className="hidden sm:inline-flex items-center gap-2 rounded-full bg-white/20 backdrop-blur px-4 py-2 text-sm font-medium shrink-0">
              查看课程 <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
            <ArrowRight className="sm:hidden h-5 w-5 opacity-90 group-hover:translate-x-1 transition-transform" />
          </Link>
        </section>

        {/* 三张小卡 */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-5">
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
            to="/stats"
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

        {!user && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="p-5 flex items-center justify-between gap-4">
              <div className="text-sm">
                <div className="font-semibold">注册后所有进度自动云端保存</div>
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

      </main>
    </div>
  );
}
