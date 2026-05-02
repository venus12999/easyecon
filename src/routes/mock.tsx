import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { addWrong, recordAnswer } from "@/lib/storage";
import { Clock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/mock")({
  head: () => ({ meta: [{ title: "模考模式 · AP 微观经济" }] }),
  component: Mock,
});

type Q = {
  id: string;
  knowledge_point_id: string;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string | null;
  correct_answer: OptKey;
  explanation: string;
  term_tags: string[] | null;
  knowledge_points: { name_zh: string } | null;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Mock() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [size, setSize] = useState(15);
  const [pool, setPool] = useState<Q[]>([]);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, OptKey>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});

  useEffect(() => {
    supabase
      .from("terms")
      .select("term_en,term_zh,definition")
      .then(({ data }) => {
        const d: Record<string, TermInfo> = {};
        (data ?? []).forEach((t) => (d[t.term_en.toLowerCase()] = t as TermInfo));
        setTermDict(d);
      });
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setLoading(true);
    const { data } = await supabase
      .from("questions")
      .select("id,knowledge_point_id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,term_tags,knowledge_points(name_zh)")
      .eq("status", "published");
    const all = (data ?? []) as unknown as Q[];
    setPool(all);
    const picked = shuffle(all).slice(0, Math.min(size, all.length));
    setQuestions(picked);
    setAnswers({});
    setIdx(0);
    setSeconds(0);
    setPhase("running");
    setLoading(false);
  }

  function submit() {
    questions.forEach((q) => {
      const a = answers[q.id];
      const ok = a === q.correct_answer;
      recordAnswer(q.knowledge_point_id, ok);
      if (!ok && a) addWrong(q.id);
    });
    setPhase("done");
  }

  const stats = useMemo(() => {
    if (phase !== "done") return null;
    const total = questions.length;
    const correct = questions.filter((q) => answers[q.id] === q.correct_answer).length;
    const byKp: Record<string, { name: string; total: number; correct: number }> = {};
    questions.forEach((q) => {
      const name = q.knowledge_points?.name_zh ?? "—";
      const k = q.knowledge_point_id;
      if (!byKp[k]) byKp[k] = { name, total: 0, correct: 0 };
      byKp[k].total += 1;
      if (answers[q.id] === q.correct_answer) byKp[k].correct += 1;
    });
    const wrong = questions.filter((q) => answers[q.id] !== q.correct_answer);
    return { total, correct, byKp, wrong };
  }, [phase, questions, answers]);

  if (phase === "idle") {
    return (
      <div className="min-h-screen bg-background">
        
        <main className="mx-auto max-w-2xl px-4 py-12">
          <h1 className="text-2xl font-bold mb-2">模考模式</h1>
          <p className="text-muted-foreground text-sm mb-6">
            从已发布题库中随机抽取 N 题，计时作答。交卷后展示总分、按知识点分布与错题。
          </p>
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium">题数</label>
                <div className="flex gap-2 mt-2">
                  {[10, 15, 25].map((n) => (
                    <Button
                      key={n}
                      variant={size === n ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSize(n)}
                    >
                      {n} 题
                    </Button>
                  ))}
                </div>
              </div>
              <Button onClick={start} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "开始模考"}
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (phase === "running") {
    const cur = questions[idx];
    if (!cur) return null;
    const opts: Array<{ k: OptKey; v: string }> = [
      { k: "A", v: cur.option_a }, { k: "B", v: cur.option_b },
      { k: "C", v: cur.option_c }, { k: "D", v: cur.option_d },
      ...(cur.option_e ? [{ k: "E" as OptKey, v: cur.option_e }] : []),
    ];
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return (
      <div className="min-h-screen bg-background">
        
        <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{idx + 1} / {questions.length}</div>
            <div className="flex items-center gap-1.5 text-sm font-mono">
              <Clock className="h-4 w-4 text-primary" />
              {mm}:{ss}
            </div>
          </div>
          <Progress value={((idx + 1) / questions.length) * 100} className="mb-6" />
          <Card>
            <CardContent className="p-6 space-y-5">
              <p className="text-base leading-relaxed">
                {renderStemWithTerms(cur.stem, cur.term_tags ?? [], termDict)}
              </p>
              <div className="space-y-2">
                {opts.map((o) => {
                  const picked = answers[cur.id] === o.k;
                  const s = optionStyles[o.k];
                  return (
                    <button
                      key={o.k}
                      onClick={() => setAnswers({ ...answers, [cur.id]: o.k })}
                      className="w-full text-left rounded-lg border-2 px-4 py-3 flex items-start gap-3 transition-all"
                      style={{
                        borderColor: picked ? s.border : "transparent",
                        background: s.bgSoft,
                      }}
                    >
                      <span
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ background: s.bg }}
                      >
                        {o.k}
                      </span>
                      <span className="flex-1 text-sm pt-1" style={{ color: s.ink }}>
                        {renderStemWithTerms(o.v, cur.term_tags ?? [], termDict)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <div className="mt-6 flex items-center justify-between">
            <Button variant="outline" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              上一题
            </Button>
            {idx < questions.length - 1 ? (
              <Button onClick={() => setIdx(idx + 1)}>下一题</Button>
            ) : (
              <Button onClick={submit}>交卷</Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  // done
  if (!stats) return null;
  const pct = Math.round((stats.correct / stats.total) * 100);
  return (
    <div className="min-h-screen bg-background">
      
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">模考结果</h1>
        <p className="text-muted-foreground text-sm mb-6">用时 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒</p>
        <Card className="mb-6">
          <CardContent className="p-6 text-center">
            <div className="text-5xl font-bold text-primary">{pct}<span className="text-2xl text-muted-foreground">%</span></div>
            <div className="mt-2 text-sm text-muted-foreground">{stats.correct} / {stats.total} 题正确</div>
          </CardContent>
        </Card>
        <h2 className="font-semibold mb-3">按知识点</h2>
        <div className="space-y-2 mb-6">
          {Object.entries(stats.byKp).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm border rounded-md px-3 py-2 bg-card">
              <span>{v.name}</span>
              <span className="text-muted-foreground">{v.correct} / {v.total}</span>
            </div>
          ))}
        </div>
        {stats.wrong.length > 0 && (
          <>
            <h2 className="font-semibold mb-3">错题（{stats.wrong.length}）</h2>
            <div className="space-y-2 mb-6">
              {stats.wrong.map((q) => (
                <Card key={q.id}>
                  <CardContent className="p-3 text-sm">
                    <p className="line-clamp-2">{q.stem}</p>
                    <p className="text-xs text-muted-foreground mt-1">正确：{q.correct_answer} · 你选：{answers[q.id] ?? "未作答"}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-2">
          <Button onClick={() => setPhase("idle")}>再来一次</Button>
          <Button asChild variant="outline"><Link to="/">返回首页</Link></Button>
        </div>
      </main>
    </div>
  );
}