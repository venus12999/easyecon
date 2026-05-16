import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { addWrong, recordAnswer } from "@/lib/storage";
import { Loader2, ArrowLeft, Bookmark, ChevronDown, ChevronUp, X, MoreVertical, Highlighter, Calculator as CalcIcon, MapPin, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mock/$slug")({
  head: () => ({ meta: [{ title: "真题卷 · AP 微观经济" }] }),
  component: PaperRunner,
});

type Paper = {
  id: string;
  slug: string;
  title: string;
  total_seconds: number;
  description: string | null;
};

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
  image_url: string | null;
  term_tags: string[] | null;
  knowledge_points: { name_zh: string; unit: number } | null;
};

type Frq = {
  id: string;
  title: string | null;
  content: string;
  image_url: string | null;
  sort_order: number;
};

function PaperRunner() {
  const { slug } = useParams({ from: "/mock/$slug" });
  const { user } = useAuth();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [frqs, setFrqs] = useState<Frq[]>([]);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [answers, setAnswers] = useState<Record<string, OptKey>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const remaining = paper ? Math.max(0, paper.total_seconds - seconds) : 0;
  const timeUp = phase === "running" && remaining === 0;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("mock_papers")
        .select("id,slug,title,total_seconds,description")
        .eq("slug", slug)
        .maybeSingle();
      if (!p) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPaper(p as Paper);
      const [{ data: pqs }, { data: fr }, { data: terms }] = await Promise.all([
        supabase
          .from("paper_questions")
          .select(
            "sort_order,questions!inner(id,knowledge_point_id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,image_url,term_tags,knowledge_points!inner(name_zh,unit))",
          )
          .eq("paper_id", p.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("paper_frqs")
          .select("id,title,content,image_url,sort_order")
          .eq("paper_id", p.id)
          .order("sort_order", { ascending: true }),
        supabase.from("terms").select("term_en,term_zh,definition"),
      ]);
      const qs = ((pqs ?? []) as unknown as Array<{ questions: Q }>).map((row) => row.questions);
      setQuestions(qs);
      setFrqs((fr ?? []) as Frq[]);
      const d: Record<string, TermInfo> = {};
      (terms ?? []).forEach((t) => (d[t.term_en.toLowerCase()] = t as TermInfo));
      setTermDict(d);
      setLoading(false);
    })();
  }, [slug]);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (timeUp) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  function start() {
    setAnswers({});
    setIdx(0);
    setSeconds(0);
    setPhase("running");
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
    const wrong = questions.filter((q) => answers[q.id] !== q.correct_answer);
    return { total, correct, wrong };
  }, [phase, questions, answers]);

  if (loading) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </main>
    );
  }

  if (notFound || !paper) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <h1 className="text-xl font-bold">未找到该真题卷</h1>
        <Button asChild variant="outline">
          <Link to="/mock">返回卷库</Link>
        </Button>
      </main>
    );
  }

  if (phase === "idle") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Link
          to="/mock"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 卷库
        </Link>
        <h1 className="text-2xl font-bold mb-2">{paper.title}</h1>
        {paper.description && (
          <p className="text-sm text-muted-foreground mb-6">{paper.description}</p>
        )}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="border rounded-md py-3">
                <div className="text-2xl font-bold text-primary">{questions.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">选择题</div>
              </div>
              <div className="border rounded-md py-3">
                <div className="text-2xl font-bold text-primary">{frqs.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">简答题</div>
              </div>
              <div className="border rounded-md py-3">
                <div className="text-2xl font-bold text-primary">{Math.round(paper.total_seconds / 60)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">分钟</div>
              </div>
            </div>
            <Button onClick={start} disabled={questions.length === 0} className="w-full">
              开始作答
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (phase === "running") {
    const cur = questions[idx];
    if (!cur) return null;
    const opts: Array<{ k: OptKey; v: string }> = [
      { k: "A", v: cur.option_a },
      { k: "B", v: cur.option_b },
      { k: "C", v: cur.option_c },
      { k: "D", v: cur.option_d },
      ...(cur.option_e ? [{ k: "E" as OptKey, v: cur.option_e }] : []),
    ];
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    const lowTime = remaining <= 5 * 60;
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            第 <span className="font-bold text-foreground">{idx + 1}</span> 题 / 共 {questions.length} 题
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-mono ${lowTime ? "text-destructive font-bold" : ""}`}>
            <Clock className={`h-4 w-4 ${lowTime ? "text-destructive" : "text-primary"}`} />
            {mm}:{ss}
          </div>
        </div>
        <Progress value={((idx + 1) / questions.length) * 100} className="mb-6" />
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="text-xs font-semibold text-primary uppercase tracking-wide">
              Question {idx + 1}
            </div>
            <p className="text-base leading-relaxed">
              {renderStemWithTerms(cur.stem, cur.term_tags ?? [], termDict)}
            </p>
            {cur.image_url && (
              <img src={cur.image_url} alt="题图" className="max-h-80 w-auto rounded border border-border" />
            )}
            <div className="space-y-2">
              {opts.map((o) => {
                const picked = answers[cur.id] === o.k;
                const s = optionStyles[o.k];
                return (
                  <button
                    key={o.k}
                    onClick={() => setAnswers({ ...answers, [cur.id]: o.k })}
                    className="w-full text-left rounded-lg border-2 px-4 py-3 flex items-start gap-3 transition-all"
                    style={{ borderColor: picked ? s.border : "transparent", background: s.bgSoft }}
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
    );
  }

  if (!stats) return null;
  const pct = stats.total === 0 ? 0 : Math.round((stats.correct / stats.total) * 100);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">{paper.title} · 结果</h1>
      <p className="text-muted-foreground text-sm mb-6">
        用时 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒
      </p>
      <Card className="mb-6">
        <CardContent className="p-6 text-center">
          <div className="text-5xl font-bold text-primary">
            {pct}
            <span className="text-2xl text-muted-foreground">%</span>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {stats.correct} / {stats.total} 题正确
          </div>
        </CardContent>
      </Card>

      {frqs.length > 0 && (
        <>
          <h2 className="font-semibold mb-3">简答题（FRQ）</h2>
          <p className="text-xs text-muted-foreground mb-3">
            FRQ 暂仅展示题目，请自行作答后比对官方评分指南。
          </p>
          <div className="space-y-3 mb-6">
            {frqs.map((f, i) => (
              <Card key={f.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="font-semibold">
                    Question {i + 1}
                    {f.title ? ` · ${f.title}` : ""}
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{f.content}</p>
                  {f.image_url && (
                    <img src={f.image_url} alt="FRQ 图" className="max-h-80 w-auto rounded border border-border" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={() => { setPhase("idle"); }}>再做一遍</Button>
        <Button asChild variant="outline">
          <Link to="/mock">返回卷库</Link>
        </Button>
      </div>
    </main>
  );
}