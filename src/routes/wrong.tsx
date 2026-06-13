import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getWrong, removeWrong } from "@/lib/storage";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/wrong")({
  head: () => ({ meta: [{ title: "错题本 · AP 微观经济" }] }),
  component: WrongBook,
});

type QType = "basic" | "application" | "pitfall";
type Q = {
  id: string;
  source: "practice" | "mock";
  stem: string;
  type: QType;
  knowledge_point_id: string;
  added_at: string | null;
  knowledge_points: { name_zh: string; slug: string; unit: number } | null;
};

type RangeKey = "7" | "30" | "90" | "all";
const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};
const TYPE_LABEL: Record<QType, string> = {
  basic: "基础题（概念）",
  application: "应用题（情境）",
  pitfall: "易错题（常见坑）",
};

function WrongBook() {
  const { user } = useAuth();
  const [items, setItems] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [kpFilter, setKpFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<RangeKey>("30");

  async function load() {
    let records: Array<{ question_id: string; added_at: string | null; source: "practice" | "mock" }> = [];
    if (user) {
      const { data } = await supabase
        .from("wrong_questions")
        .select("question_id,added_at,source")
        .eq("user_id", user.id);
      records = (data ?? []).map((r) => ({
        question_id: r.question_id,
        added_at: r.added_at,
        source: r.source === "mock" ? "mock" : "practice",
      }));
    } else {
      records = getWrong().map((question_id) => ({ question_id, added_at: null, source: "practice" }));
    }
    const ids = Array.from(new Set(records.map((r) => r.question_id)));
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data: qs, error: qErr } = await supabase
      .from("questions")
      .select("id,stem,type,knowledge_point_id")
      .in("id", ids);
    if (qErr) {
      console.error("[wrong] questions query failed", qErr);
      setItems([]);
      setLoading(false);
      return;
    }
    const kpIds = Array.from(new Set((qs ?? []).map((q) => q.knowledge_point_id)));
    const kpMap: Record<string, { name_zh: string; slug: string; unit: number }> = {};
    if (kpIds.length > 0) {
      const { data: kps } = await supabase
        .from("knowledge_points")
        .select("id,name_zh,slug,unit")
        .in("id", kpIds);
      (kps ?? []).forEach((k) => {
        kpMap[k.id] = { name_zh: k.name_zh, slug: k.slug, unit: k.unit };
      });
    }
    const qMap = new Map((qs ?? []).map((q) => [q.id, q]));
    const merged: Q[] = records.flatMap((record) => {
      const q = qMap.get(record.question_id);
      if (!q) return [];
      return [{
        id: q.id,
        source: record.source,
        stem: q.stem,
        type: q.type as QType,
        knowledge_point_id: q.knowledge_point_id,
        added_at: record.added_at,
        knowledge_points: kpMap[q.knowledge_point_id] ?? null,
      }];
    });
    setItems(merged);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [user]);

  const units = useMemo(() => {
    const s = new Set<number>();
    items.forEach((q) => q.knowledge_points && s.add(q.knowledge_points.unit));
    return Array.from(s).sort((a, b) => a - b);
  }, [items]);

  const kpOptions = useMemo(() => {
    const map = new Map<string, { name_zh: string; unit: number }>();
    items.forEach((q) => {
      if (!q.knowledge_points) return;
      if (unitFilter !== "all" && String(q.knowledge_points.unit) !== unitFilter) return;
      map.set(q.knowledge_point_id, {
        name_zh: q.knowledge_points.name_zh,
        unit: q.knowledge_points.unit,
      });
    });
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.unit - b.unit || a.name_zh.localeCompare(b.name_zh));
  }, [items, unitFilter]);

  const cutoff = useMemo(() => {
    const days = RANGE_DAYS[rangeFilter];
    if (days == null) return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  }, [rangeFilter]);

  const filtered = useMemo(() => {
    return items.filter((q) => {
      if (unitFilter !== "all" && String(q.knowledge_points?.unit) !== unitFilter) return false;
      if (kpFilter !== "all" && q.knowledge_point_id !== kpFilter) return false;
      if (typeFilter !== "all" && q.type !== typeFilter) return false;
      if (sourceFilter !== "all" && q.source !== sourceFilter) return false;
      if (cutoff && user) {
        if (!q.added_at) return false;
        if (new Date(q.added_at) < cutoff) return false;
      }
      return true;
    });
  }, [items, unitFilter, kpFilter, typeFilter, sourceFilter, cutoff, user]);

  const trend = useMemo(() => {
    const days = RANGE_DAYS[rangeFilter] ?? 30;
    const buckets: { date: string; count: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(5, 10);
      buckets.push({ date: key, count: 0 });
      map.set(d.toISOString().slice(0, 10), buckets.length - 1);
    }
    filtered.forEach((q) => {
      if (!q.added_at) return;
      const k = new Date(q.added_at).toISOString().slice(0, 10);
      const idx = map.get(k);
      if (idx != null) buckets[idx].count += 1;
    });
    return buckets;
  }, [filtered, rangeFilter]);

  const typeCounts = useMemo(() => {
    const c: Record<QType, number> = { basic: 0, application: 0, pitfall: 0 };
    filtered.forEach((q) => (c[q.type] += 1));
    return c;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">错题本</h1>
        <p className="text-muted-foreground text-sm mb-6">
          {user ? "已同步至云端" : "数据保存在你的浏览器本地（登录后可同步并查看趋势）"}
        </p>

        {loading ? (
          <p className="text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              暂无错题。继续刷题吧 →
              <div className="mt-4">
                <Button asChild><Link to="/">去刷题</Link></Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {/* 概览 + 趋势图 */}
            <Card>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground">当前筛选下的错题</div>
                    <div className="text-3xl font-bold">
                      {filtered.length}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">/ {items.length}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <Badge variant="secondary">概念 {typeCounts.basic}</Badge>
                    <Badge variant="secondary">应用 {typeCounts.application}</Badge>
                    <Badge variant="secondary">易错 {typeCounts.pitfall}</Badge>
                  </div>
                </div>
                {user ? (
                  <div className="h-40 -mx-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="wrongTrend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={28} />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          fill="url(#wrongTrend)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">登录后可显示按天的新增错题趋势。</p>
                )}
              </CardContent>
            </Card>

            {/* 筛选 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder="来源" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部来源</SelectItem>
                  <SelectItem value="practice">日常刷题</SelectItem>
                  <SelectItem value="mock">模拟考试</SelectItem>
                </SelectContent>
              </Select>
              <Select value={unitFilter} onValueChange={(v) => { setUnitFilter(v); setKpFilter("all"); }}>
                <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部 Unit</SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u} value={String(u)}>Unit {u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={kpFilter} onValueChange={setKpFilter}>
                <SelectTrigger><SelectValue placeholder="知识点" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部知识点</SelectItem>
                  {kpOptions.map((k) => (
                    <SelectItem key={k.id} value={k.id}>U{k.unit}·{k.name_zh}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue placeholder="题型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部题型</SelectItem>
                  <SelectItem value="basic">概念</SelectItem>
                  <SelectItem value="application">应用</SelectItem>
                  <SelectItem value="pitfall">易错</SelectItem>
                </SelectContent>
              </Select>
              <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as RangeKey)}>
                <SelectTrigger><SelectValue placeholder="时间" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">近 7 天</SelectItem>
                  <SelectItem value="30">近 30 天</SelectItem>
                  <SelectItem value="90">近 90 天</SelectItem>
                  <SelectItem value="all">全部时间</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 列表 */}
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  当前筛选下没有错题。
                </CardContent>
              </Card>
            ) : (
              (["basic", "application", "pitfall"] as const).map((t) => {
                const group = filtered.filter((q) => q.type === t);
                if (group.length === 0) return null;
                return (
                  <div key={t}>
                    <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                      {TYPE_LABEL[t]} · {group.length}
                    </h2>
                    <div className="space-y-3">
                      {group.map((q) => (
              <Card key={`${q.id}-${q.source}`}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-primary mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant={q.source === "mock" ? "default" : "secondary"}>
                        {q.source === "mock" ? "模拟考试" : "日常刷题"}
                      </Badge>
                      {q.knowledge_points ? `U${q.knowledge_points.unit} · ${q.knowledge_points.name_zh}` : ""}
                      {q.added_at && (
                        <span className="ml-2 text-muted-foreground">
                          {new Date(q.added_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm line-clamp-2">{q.stem}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {q.knowledge_points?.slug && (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/practice/$slug" params={{ slug: q.knowledge_points.slug }} search={{}}>
                          重做
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (q.source === "practice") removeWrong(q.id);
                        if (user) {
                          await supabase
                            .from("wrong_questions")
                            .delete()
                            .eq("user_id", user.id)
                            .eq("question_id", q.id)
                            .eq("source", q.source);
                        }
                        load();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}