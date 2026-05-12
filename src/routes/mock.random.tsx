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
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/mock/random")({
  head: () => ({ meta: [{ title: "模考模式 · AP 微观经济" }] }),
  component: Mock,
});

type Q = {
  id: string;
  knowledge_point_id: string;
  unit: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string | null;
  correct_answer: OptKey;
  explanation: string;
  term_tags: string[] | null;
  knowledge_points: { name_zh: string; unit: number } | null;
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
  const { user } = useAuth();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, OptKey>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [shortageNote, setShortageNote] = useState<string | null>(null);

  // 官方 AP 微观考试：60 题 / 70 分钟
  const TOTAL_QUESTIONS = 60;
  const TIME_LIMIT_SECONDS = 70 * 60;
  // 每个 Unit 的目标题数（均落在官方比例区间内，合计 60）
  // U1 13.3% / U2 23.3% / U3 20% / U4 18.3% / U5 11.7% / U6 13.3%
  const UNIT_TARGETS: Record<number, number> = { 1: 8, 2: 14, 3: 12, 4: 11, 5: 7, 6: 8 };
  const remainingSeconds = Math.max(0, TIME_LIMIT_SECONDS - seconds);
  const timeUp = phase === "running" && remainingSeconds === 0;

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

  // 时间到自动交卷
  useEffect(() => {
    if (timeUp) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  async function start() {
    setLoading(true);
    setShortageNote(null);
    const { data } = await supabase
      .from("questions")
      .select("id,knowledge_point_id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,term_tags,knowledge_points!inner(name_zh,unit)")
      .eq("status", "published");
    const all = ((data ?? []) as unknown as Q[]).map((q) => ({
      ...q,
      unit: q.knowledge_points?.unit ?? 0,
    }));

    // 按 unit 分组并按目标抽取
    const picked: Q[] = [];
    const usedIds = new Set<string>();
    const shortages: string[] = [];
    for (const [unitStr, target] of Object.entries(UNIT_TARGETS)) {
      const unit = Number(unitStr);
      const bucket = all.filter((q) => q.unit === unit);
      const take = shuffle(bucket).slice(0, target);
      take.forEach((q) => usedIds.add(q.id));
      picked.push(...take);
      if (take.length < target) shortages.push(`Unit ${unit} 缺 ${target - take.length} 题`);
    }
    // 题库不足时，从剩余题中随机补到 60 题
    if (picked.length < TOTAL_QUESTIONS) {
      const remain = shuffle(all.filter((q) => !usedIds.has(q.id))).slice(
        0,
        TOTAL_QUESTIONS - picked.length,
      );
      picked.push(...remain);
    }
    if (shortages.length > 0) {
      setShortageNote(`题库不足，已用其他单元补齐：${shortages.join("、")}`);
    }
    // 整体打乱顺序
    const finalQuestions = shuffle(picked);
    setQuestions(finalQuestions);
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
    if (user) {
      const total = questions.length;
      const correct = questions.filter((q) => answers[q.id] === q.correct_answer).length;
      const detail = questions.map((q) => ({
        question_id: q.id,
        knowledge_point_id: q.knowledge_point_id,
        picked: answers[q.id] ?? null,
        correct: q.correct_answer,
        is_correct: answers[q.id] === q.correct_answer,
      }));
      void supabase.from("mock_attempts").insert({
        user_id: user.id,
        total,
        correct,
        duration_seconds: seconds,
        detail,
      });
      const rows = questions
        .filter((q) => !!answers[q.id])
        .map((q) => ({
          user_id: user.id,
          question_id: q.id,
          knowledge_point_id: q.knowledge_point_id,
          picked_answer: answers[q.id],
          is_correct: answers[q.id] === q.correct_answer,
          mode: "mock",
        }));
      if (rows.length > 0) void supabase.from("answer_attempts").insert(rows);
      const wrongRows = questions
        .filter((q) => answers[q.id] !== q.correct_answer)
        .map((q) => ({ user_id: user.id, question_id: q.id }));
      if (wrongRows.length > 0) {
        void supabase
          .from("wrong_questions")
          .upsert(wrongRows, { onConflict: "user_id,question_id" });
      }
    }
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
          <h1 className="text-2xl font-bold mb-2">完整模考（AP 官方比例）</h1>
          <p className="text-muted-foreground text-sm mb-6">
            按 AP 微观经济考试规格随机抽取 <b>60 道</b> 多选题，限时 <b>70 分钟</b>，时间到自动交卷。
          </p>
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2 text-sm">
                <div className="font-medium">单元题数分布（与 AP 官方比例一致）</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(UNIT_TARGETS).map(([u, n]) => (
                    <div key={u} className="flex justify-between border rounded px-2 py-1.5 bg-card">
                      <span>Unit {u}</span>
                      <span className="text-muted-foreground">
                        {n} 题 · {((n / TOTAL_QUESTIONS) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <Button onClick={start} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "开始模考（60 题 / 70 分钟）"}
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
    const mm = String(Math.floor(remainingSeconds / 60)).padStart(2, "0");
    const ss = String(remainingSeconds % 60).padStart(2, "0");
    const lowTime = remainingSeconds <= 5 * 60;
    return (
      <div className="min-h-screen bg-background">
        
        <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
          {shortageNote && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs px-3 py-2">
              {shortageNote}
            </div>
          )}
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{idx + 1} / {questions.length}</div>
            <div className={`flex items-center gap-1.5 text-sm font-mono ${lowTime ? "text-destructive font-bold" : ""}`}>
              <Clock className={`h-4 w-4 ${lowTime ? "text-destructive" : "text-primary"}`} />
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