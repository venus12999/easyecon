import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { addWrong, recordAnswer } from "@/lib/storage";
import { Loader2, ArrowLeft, Bookmark, ChevronDown, ChevronUp, X, MoreVertical, Highlighter, Calculator as CalcIcon, MapPin, Move, Delete } from "lucide-react";
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
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [crossed, setCrossed] = useState<Record<string, Set<OptKey>>>({});
  const [eliminateMode, setEliminateMode] = useState(false);
  const [hideTime, setHideTime] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

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
    const isMarked = marked.has(cur.id);
    const curCrossed = crossed[cur.id] ?? new Set<OptKey>();
    const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Student";
    const toggleMark = () => {
      const next = new Set(marked);
      if (next.has(cur.id)) next.delete(cur.id);
      else next.add(cur.id);
      setMarked(next);
    };
    const toggleCross = (k: OptKey) => {
      const next = new Set(curCrossed);
      if (next.has(k)) next.delete(k);
      else {
        next.add(k);
        if (answers[cur.id] === k) {
          const a = { ...answers };
          delete a[cur.id];
          setAnswers(a);
        }
      }
      setCrossed({ ...crossed, [cur.id]: next });
    };
    return (
      <div className="fixed inset-0 z-50 bg-white text-slate-900 flex flex-col font-serif">
        {/* Top bar */}
        <header className="h-14 border-b border-slate-300 flex items-center px-6 shrink-0 bg-white">
          <div className="flex-1 flex items-center gap-6">
            <div>
              <div className="font-bold text-base">Section I</div>
              <button
                onClick={() => setShowDirections(true)}
                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                Directions <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div className={cn("font-mono text-lg tabular-nums", lowTime && !hideTime && "text-red-600 font-bold")}>
              {hideTime ? "—:—" : `${mm}:${ss}`}
            </div>
            <button
              onClick={() => setHideTime((v) => !v)}
              className="text-xs px-3 py-0.5 rounded-full border border-slate-400 hover:bg-slate-100"
            >
              {hideTime ? "Show" : "Hide"}
            </button>
          </div>
          <div className="flex-1 flex items-center justify-end gap-5 text-[11px]">
            <button className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-slate-900">
              <Highlighter className="h-5 w-5" />
              <span>Highlights & Notes</span>
            </button>
            <button
              onClick={() => setShowCalc(true)}
              className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-slate-900"
            >
              <CalcIcon className="h-5 w-5" />
              <span>Calculator</span>
            </button>
            <button className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-slate-900">
              <MoreVertical className="h-5 w-5" />
              <span>More</span>
            </button>
          </div>
        </header>

        {/* Preview banner */}
        <div className="bg-[#1a2b6b] text-white text-center text-xs font-bold tracking-widest py-1.5">
          THIS IS A TEST PREVIEW
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6">
            {/* Question header bar */}
            <div className="flex items-center justify-between border-b-2 border-dashed border-slate-300 pb-2 mb-5">
              <div className="flex items-center gap-3">
                <span className="bg-slate-900 text-white font-bold px-2.5 py-1 text-sm rounded-sm">
                  {idx + 1}
                </span>
                <button
                  onClick={toggleMark}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-sm hover:text-red-600 transition-colors",
                    isMarked ? "text-red-600 font-semibold" : "text-slate-700",
                  )}
                >
                  <Bookmark className={cn("h-4 w-4", isMarked && "fill-red-600")} />
                  Mark for Review
                </button>
              </div>
              <button
                onClick={() => setEliminateMode((v) => !v)}
                className={cn(
                  "text-xs font-bold px-2 py-1 rounded border-2",
                  eliminateMode
                    ? "bg-[#1a2b6b] text-white border-[#1a2b6b]"
                    : "bg-white text-[#1a2b6b] border-[#1a2b6b]",
                )}
                title="Answer Eliminator"
              >
                <span className="line-through">ABC</span>
              </button>
            </div>

            {/* Stem */}
            <div className="text-[17px] leading-relaxed mb-6">
              {renderStemWithTerms(cur.stem, cur.term_tags ?? [], termDict)}
            </div>
            {cur.image_url && (
              <img src={cur.image_url} alt="题图" className="max-h-80 w-auto rounded border border-slate-300 mb-6" />
            )}

            {/* Options */}
            <div className="space-y-3">
              {opts.map((o) => {
                const picked = answers[cur.id] === o.k;
                const isCrossed = curCrossed.has(o.k);
                return (
                  <div key={o.k} className="flex items-stretch gap-3">
                    <button
                      onClick={() => {
                        if (isCrossed) return;
                        setAnswers({ ...answers, [cur.id]: o.k });
                      }}
                      disabled={isCrossed}
                      className={cn(
                        "flex-1 text-left rounded-lg border px-4 py-3 flex items-center gap-3 transition-all bg-white",
                        picked
                          ? "border-[#1a2b6b] border-2 ring-2 ring-[#1a2b6b]/20"
                          : "border-slate-400 hover:border-slate-600",
                        isCrossed && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-sm font-semibold",
                          picked
                            ? "bg-[#1a2b6b] text-white border-[#1a2b6b]"
                            : "bg-white text-slate-700 border-slate-500",
                          isCrossed && "line-through",
                        )}
                      >
                        {o.k}
                      </span>
                      <span className={cn("flex-1 text-[15px]", isCrossed && "line-through text-slate-500")}>
                        {renderStemWithTerms(o.v, cur.term_tags ?? [], termDict)}
                      </span>
                      {isCrossed && (
                        <span className="absolute left-12 right-16 border-t border-slate-700 pointer-events-none" />
                      )}
                    </button>
                    {eliminateMode &&
                      (isCrossed ? (
                        <button
                          onClick={() => toggleCross(o.k)}
                          className="px-2 self-center text-sm font-bold text-slate-900 underline"
                        >
                          Undo
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleCross(o.k)}
                          className="shrink-0 self-center w-8 h-8 rounded-full border border-slate-500 flex items-center justify-center text-xs font-bold text-slate-700 hover:bg-slate-100"
                          title="Cross out"
                        >
                          {o.k}
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <footer className="h-16 border-t border-slate-300 bg-white flex items-center px-6 shrink-0 relative">
          <div className="flex-1 font-bold text-base">{userName}</div>
          <button
            onClick={() => setShowNav((v) => !v)}
            className="bg-slate-900 text-white rounded-full px-5 py-2 text-sm font-semibold inline-flex items-center gap-2 hover:bg-slate-800"
          >
            Question {idx + 1} of {questions.length}
            {showNav ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <div className="flex-1 flex justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-full bg-white"
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
            >
              Back
            </Button>
            {idx < questions.length - 1 ? (
              <Button
                onClick={() => setIdx(idx + 1)}
                className="rounded-full bg-[#1a2b6b] hover:bg-[#0f1e54] text-white"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={() => setConfirmSubmit(true)}
                className="rounded-full bg-[#1a2b6b] hover:bg-[#0f1e54] text-white"
              >
                Submit
              </Button>
            )}
          </div>

          {/* Question navigator popup */}
          {showNav && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNav(false)} />
              <div className="absolute bottom-[60px] left-1/2 -translate-x-1/2 z-50 w-[640px] max-w-[92vw] bg-white rounded-2xl shadow-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex-1" />
                  <h3 className="text-xl font-bold">Section I Questions</h3>
                  <div className="flex-1 flex justify-end">
                    <button onClick={() => setShowNav(false)} className="text-slate-600 hover:text-slate-900">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="border-y border-slate-200 py-2 flex items-center justify-center gap-6 text-sm mb-5">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> Current
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-4 h-4 border-2 border-dashed border-slate-500" /> Unanswered
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Bookmark className="h-4 w-4 fill-red-600 text-red-600" /> For Review
                  </span>
                </div>
                <div className="grid grid-cols-10 gap-2 mb-5">
                  {questions.map((q, i) => {
                    const answered = !!answers[q.id];
                    const isCur = i === idx;
                    const isMark = marked.has(q.id);
                    return (
                      <div key={q.id} className="relative flex flex-col items-center">
                        {isCur && <MapPin className="h-3 w-3 -mb-0.5 text-slate-900" />}
                        {isMark && !isCur && (
                          <Bookmark className="absolute -top-2 right-0 h-3 w-3 fill-red-600 text-red-600" />
                        )}
                        <button
                          onClick={() => {
                            setIdx(i);
                            setShowNav(false);
                          }}
                          className={cn(
                            "w-10 h-9 text-sm font-semibold flex items-center justify-center",
                            answered
                              ? "bg-[#1a2b6b] text-white border border-[#1a2b6b]"
                              : "border-2 border-dashed border-slate-500 text-blue-700",
                            isCur && "underline",
                          )}
                        >
                          {i + 1}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => {
                      setShowNav(false);
                      setConfirmSubmit(true);
                    }}
                    className="rounded-full border-2 border-[#1a2b6b] text-[#1a2b6b] font-semibold px-5 py-2 text-sm hover:bg-[#1a2b6b] hover:text-white"
                  >
                    Go to Review Page
                  </button>
                </div>
              </div>
            </>
          )}
        </footer>

        {/* Directions modal */}
        {showDirections && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowDirections(false)}>
            <div className="bg-white rounded-xl max-w-xl w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Directions</h3>
                <button onClick={() => setShowDirections(false)}><X className="h-5 w-5" /></button>
              </div>
              <p className="text-sm leading-relaxed text-slate-700">
                本部分共 {questions.length} 道选择题。每题仅有一个最佳答案。你可以使用屏幕右上角的计算器和高亮工具。点击底部 "Question X of Y" 可在题目之间跳转。完成后点击 Submit 交卷。
              </p>
            </div>
          </div>
        )}

        {/* Calculator modal */}
        {showCalc && <CalculatorModal onClose={() => setShowCalc(false)} />}

        {/* Submit confirm */}
        {confirmSubmit && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
              <h3 className="font-bold text-lg">确认交卷？</h3>
              <p className="text-sm text-slate-600">
                已作答 {Object.keys(answers).length} / {questions.length} 题。交卷后将无法修改。
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmSubmit(false)}>取消</Button>
                <Button className="bg-[#1a2b6b] hover:bg-[#0f1e54]" onClick={() => { setConfirmSubmit(false); submit(); }}>
                  确认交卷
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
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