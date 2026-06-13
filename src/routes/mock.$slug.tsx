import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { recordAnswer } from "@/lib/storage";
import { Loader2, ArrowLeft, Bookmark, ChevronDown, ChevronUp, X, MoreVertical, Highlighter, Calculator as CalcIcon, MapPin, Move, Delete } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { FrqAnswerBox, EMPTY_ANSWER, type FrqAnswerState } from "@/components/frq/FrqAnswerBox";
import { FrqGradeCard, type GradeResult } from "@/components/frq/FrqGradeCard";
import { toast } from "sonner";
import { FRQ_CATEGORIES, getFrqUnit } from "@/lib/frq-categories";

export const Route = createFileRoute("/mock/$slug")({
  head: () => ({ meta: [{ title: "真题卷 · AP 微观经济" }] }),
  validateSearch: (search: Record<string, unknown>) => {
    const unit = Number(search.unit);
    return {
      unit: Number.isInteger(unit) && unit >= 1 && unit <= 6 ? unit : undefined,
      frq: typeof search.frq === "string" && /^[0-9a-f-]{36}$/i.test(search.frq) ? search.frq : undefined,
    };
  },
  component: PaperRunner,
});

type Paper = {
  id: string;
  slug: string;
  title: string;
  total_seconds: number;
  frq_seconds: number;
  break_seconds: number;
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
  image_text: string | null;
  max_score: number;
  sort_order: number;
};

function PaperRunner() {
  const { slug } = useParams({ from: "/mock/$slug" });
  const { unit: selectedFrqUnit, frq: selectedFrqId } = Route.useSearch();
  const { user } = useAuth();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [frqs, setFrqs] = useState<Frq[]>([]);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [mode, setMode] = useState<"exam" | "practice">("practice");
  const [phase, setPhase] = useState<"idle" | "running" | "break" | "frq" | "done">("idle");
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [frqSeconds, setFrqSeconds] = useState(0);
  const [frqAnswers, setFrqAnswers] = useState<Record<string, FrqAnswerState>>({});
  const [frqGrades, setFrqGrades] = useState<Record<string, GradeResult>>({});
  const [grading, setGrading] = useState<Record<string, boolean>>({});
  const [frqSubmitted, setFrqSubmitted] = useState(false);
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

  // Highlighter
  const stemRef = useRef<HTMLDivElement | null>(null);
  const [highlightActive, setHighlightActive] = useState(false);
  type HlColor = "yellow" | "pink" | "blue";
  const [hlColor, setHlColor] = useState<HlColor>("yellow");
  const HL_BG: Record<HlColor, string> = {
    yellow: "#fde68a",
    pink: "#fbcfe8",
    blue: "#bfdbfe",
  };

  function onHighlightableMouseUp(container: HTMLDivElement | null) {
    if (!highlightActive) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container || !container.contains(range.commonAncestorContainer)) {
      return;
    }
    applyHighlight(hlColor, container);
  }

  function applyHighlight(color: HlColor | "erase", targetContainer?: HTMLDivElement | null) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = targetContainer ?? stemRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;
    if (color === "erase") {
      // unwrap any highlight spans intersecting the selection
      const spans = Array.from(container.querySelectorAll<HTMLSpanElement>("span[data-hl]"));
      spans.forEach((s) => {
        if (range.intersectsNode(s)) {
          const parent = s.parentNode!;
          while (s.firstChild) parent.insertBefore(s.firstChild, s);
          parent.removeChild(s);
        }
      });
    } else {
      const frag = range.extractContents();
      const span = document.createElement("span");
      span.setAttribute("data-hl", color);
      span.style.backgroundColor = HL_BG[color];
      span.style.borderRadius = "2px";
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
  }

  const remaining = paper ? Math.max(0, paper.total_seconds - seconds) : 0;
  const timeUp = phase === "running" && mode === "exam" && remaining === 0;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("mock_papers")
        .select("id,slug,title,total_seconds,frq_seconds,break_seconds,description")
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
          .select("id,title,content,image_url,image_text,max_score,sort_order")
          .eq("paper_id", p.id)
          .order("sort_order", { ascending: true }),
        supabase.from("terms").select("term_en,term_zh,definition,confusable_with"),
      ]);
      const qs = ((pqs ?? []) as unknown as Array<{ questions: Q }>).map((row) => row.questions);
      setQuestions(qs);
      const loadedFrqs = (fr ?? []) as Frq[];
      setFrqs(slug === "frq-pdf-practice"
        ? loadedFrqs.filter((item) =>
            selectedFrqId ? item.id === selectedFrqId : !selectedFrqUnit || getFrqUnit(item.title) === selectedFrqUnit,
          )
        : loadedFrqs);
      const d: Record<string, TermInfo> = {};
      (terms ?? []).forEach((t) => (d[t.term_en.toLowerCase()] = t as TermInfo));
      setTermDict(d);
      setLoading(false);
    })();
  }, [selectedFrqId, selectedFrqUnit, slug]);

  useEffect(() => {
    if (!loading && slug === "frq-pdf-practice" && phase === "idle" && frqs.length > 0) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, slug, phase, frqs.length]);

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
    setFrqAnswers({});
    setFrqGrades({});
    setFrqSubmitted(false);
    if (paper) {
      setBreakSeconds(paper.break_seconds ?? 600);
      setFrqSeconds(paper.frq_seconds ?? 3600);
    }
    // 仅含 FRQ 的卷子直接进入 Section II
    if (questions.length === 0 && frqs.length > 0) {
      setPhase("frq");
    } else {
      setPhase("running");
    }
  }

  function submit() {
    questions.forEach((q) => {
      const a = answers[q.id];
      const ok = a === q.correct_answer;
      recordAnswer(q.knowledge_point_id, ok);
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
        .filter((q) => !!answers[q.id] && answers[q.id] !== q.correct_answer)
        .map((q) => ({ user_id: user.id, question_id: q.id, source: "mock" }));
      if (wrongRows.length > 0) {
        void supabase.from("wrong_questions").upsert(wrongRows, {
          onConflict: "user_id,question_id,source",
        });
      }
    }
    // 有 FRQ 则进入大题阶段；仿真模式先走休息，练习模式直接进 FRQ
    if (frqs.length > 0) {
      setPhase(mode === "exam" ? "break" : "frq");
    } else {
      setFrqSubmitted(true);
      setPhase("done");
    }
  }

  // 休息倒计时（仅仿真模式）
  useEffect(() => {
    if (phase !== "break") return;
    if (breakSeconds <= 0) {
      setPhase("frq");
      return;
    }
    const t = setInterval(() => setBreakSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [phase, breakSeconds]);

  // FRQ 倒计时（仅仿真模式）
  useEffect(() => {
    if (phase !== "frq" || mode !== "exam") return;
    if (frqSeconds <= 0) {
      void submitAllFrqs();
      return;
    }
    const t = setInterval(() => setFrqSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, frqSeconds]);

  async function gradeOneFrq(f: Frq): Promise<boolean> {
    if (!paper) return false;
    const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
    if (!ans.text.trim() && !ans.fileUrl) return true; // 未作答跳过
    setGrading((g) => ({ ...g, [f.id]: true }));
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("请先登录");
        return false;
      }
      const r = await fetch("/api/frq/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          frq_id: f.id,
          paper_id: paper.id,
          mode,
          answer_text: ans.text || null,
          answer_file_url: ans.fileUrl,
          answer_file_kind: ans.fileKind,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
         const message = j.error === "membership_quota_exhausted"
           ? "今日 AI 评分次数已用完，可在个人资料页升级会员"
           : j.error === "credits_exhausted"
          ? "AI 评分额度暂时不足，请稍后重试"
          : j.error === "rate_limited"
            ? "AI 评分请求过多，请稍后重试"
            : j.error || "AI 评分失败，请稍后重试";
        toast.error(message);
        return false;
      }
      const grade = (await r.json()) as GradeResult;
      setFrqGrades((g) => ({ ...g, [f.id]: grade }));
      return true;
    } catch {
      toast.error("AI 评分失败，请检查网络后重试");
      return false;
    } finally {
      setGrading((g) => ({ ...g, [f.id]: false }));
    }
  }

  async function submitAllFrqs() {
    let gradingSucceeded = true;
    for (const f of frqs) {
      if (!frqGrades[f.id]) {
        const succeeded = await gradeOneFrq(f);
        if (!succeeded) gradingSucceeded = false;
      }
    }
    if (!gradingSucceeded) {
      toast.error("部分作答尚未评分，请重试后再查看结果");
      return;
    }
    setFrqSubmitted(true);
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
    const isFrqPractice = slug === "frq-pdf-practice";
    const selectedCategory = FRQ_CATEGORIES.find((category) => category.unit === selectedFrqUnit);
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Link
          to={isFrqPractice ? "/frq" : "/mock"}
          search={isFrqPractice && selectedFrqUnit ? { unit: selectedFrqUnit } : undefined}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {isFrqPractice ? "返回题目列表" : "卷库"}
        </Link>
        <h1 className="text-2xl font-bold mb-2">
          {selectedCategory ? `Unit ${selectedCategory.unit} · ${selectedCategory.nameZh}` : paper.title}
        </h1>
        {paper.description && (
          <p className="text-sm text-muted-foreground mb-6">{paper.description}</p>
        )}
        {!isFrqPractice && <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => setMode("exam")}
            className={cn(
              "text-left rounded-xl border-2 p-4 transition-colors",
              mode === "exam" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
            )}
          >
            <div className="font-semibold mb-1 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-xs">仿真</span>
              仿真模式
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              严格按真实 AP 考试：MCQ 限 {Math.round(paper.total_seconds / 60)} 分钟，
              休息 {Math.round((paper.break_seconds ?? 600) / 60)} 分钟（可跳过），
              再 FRQ 限 {Math.round((paper.frq_seconds ?? 3600) / 60)} 分钟。提交后才显示成绩与解析。
            </p>
          </button>
          <button
            onClick={() => setMode("practice")}
            className={cn(
              "text-left rounded-xl border-2 p-4 transition-colors",
              mode === "practice" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
            )}
          >
            <div className="font-semibold mb-1 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-xs">练习</span>
              练习模式
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              无时间限制：自由作答 MCQ，随时进入 FRQ。提交 FRQ 之后才会显示 MCQ 正确答案与 AI 解析。
            </p>
          </button>
        </div>}
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
            <Button
              onClick={start}
              disabled={questions.length === 0 && frqs.length === 0}
              className="w-full"
            >
              {questions.length === 0 && frqs.length > 0
                ? "开始刷大题"
                : `开始作答（${mode === "exam" ? "仿真模式" : "练习模式"}）`}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (phase === "break") {
    const mm = String(Math.floor(breakSeconds / 60)).padStart(2, "0");
    const ss = String(breakSeconds % 60).padStart(2, "0");
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-6">
        <h1 className="text-2xl font-bold">休息时间</h1>
        <p className="text-sm text-muted-foreground">距离 Section II（FRQ）开始还有</p>
        <div className="text-6xl font-bold font-mono text-primary">{mm}:{ss}</div>
        <Button onClick={() => setPhase("frq")}>跳过休息，立即开始 FRQ</Button>
      </main>
    );
  }

  if (phase === "frq") {
    const mm = String(Math.floor(frqSeconds / 60)).padStart(2, "0");
    const ss = String(frqSeconds % 60).padStart(2, "0");
    const allGrading = Object.values(grading).some(Boolean);
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{questions.length === 0 ? "大题练习 · FRQ" : "Section II · FRQ"}</h1>
            <p className="text-xs text-muted-foreground">
              {mode === "exam" ? "仿真模式：到点自动交卷" : "无时间限制，按得分点逐题评分"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setHighlightActive((v) => !v)}
              className={cn(
                "flex flex-col items-center gap-0.5 text-[11px] transition-colors",
                highlightActive ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Highlighter className="h-5 w-5" />
              <span>Highlights</span>
            </button>
            {highlightActive && (
              <div className="flex items-center gap-1.5">
                {(["yellow", "pink", "blue"] as HlColor[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setHlColor(c)}
                    title={c}
                    className={cn(
                      "h-5 w-5 rounded-full border-2 transition-all",
                      hlColor === c ? "border-foreground scale-110" : "border-transparent",
                    )}
                    style={{ backgroundColor: HL_BG[c] }}
                  />
                ))}
                <button
                  onClick={() => applyHighlight("erase")}
                  className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
                  title="清除所选高亮"
                >
                  擦除
                </button>
              </div>
            )}
          </div>
          {mode === "exam" && (
            <div className="text-right">
              <div className="font-mono text-lg tabular-nums text-primary">{mm}:{ss}</div>
              <div className="text-xs text-muted-foreground">剩余时间</div>
            </div>
          )}
        </div>

        {frqs.map((f, i) => {
          const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
          const grade = frqGrades[f.id];
          return (
            <Card key={f.id}>
              <CardContent className="p-5 space-y-4">
                <div className="font-semibold">
                  Question {i + 1}
                  {f.title ? ` · ${f.title}` : ""}
                  <span className="ml-2 text-xs text-muted-foreground">满分 {f.max_score} 分</span>
                </div>
                <div
                  onMouseUp={(e) => onHighlightableMouseUp(e.currentTarget)}
                  className={cn(
                    "text-sm whitespace-pre-wrap leading-relaxed select-text",
                    highlightActive && "cursor-text",
                  )}
                >
                  {f.content}
                </div>
                {f.image_url && (
                  <img src={f.image_url} alt="FRQ 图" className="max-h-80 w-auto rounded border border-border" />
                )}
                {f.image_text && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">查看题图中的文字</summary>
                    <pre className="mt-2 p-2 bg-muted rounded whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{f.image_text}</pre>
                  </details>
                )}
                <FrqAnswerBox
                  paperId={paper.id}
                  frqId={f.id}
                  value={ans}
                  onChange={(v) => setFrqAnswers((s) => ({ ...s, [f.id]: v }))}
                  disabled={!!grade}
                />
                {!grade && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void gradeOneFrq(f)}
                    disabled={grading[f.id] || (!ans.text.trim() && !ans.fileUrl)}
                  >
                    {grading[f.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    单独评分本题
                  </Button>
                )}
                {grade && <FrqGradeCard grade={grade} />}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end gap-2">
          <Button onClick={() => void submitAllFrqs()} disabled={allGrading}>
            {allGrading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "exam" ? "交卷并查看全部成绩" : "完成并查看全部评分"}
          </Button>
        </div>
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
            <button
              onClick={() => setHighlightActive((v) => !v)}
              className={cn(
                "flex flex-col items-center gap-0.5 transition-colors",
                highlightActive ? "text-[#1a2b6b] font-bold" : "text-slate-700 hover:text-slate-900",
              )}
            >
              <Highlighter className="h-5 w-5" />
              <span>Highlights</span>
            </button>
            {highlightActive && (
              <div className="flex items-center gap-1.5">
                {(["yellow", "pink", "blue"] as HlColor[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setHlColor(c)}
                    title={c}
                    className={cn(
                      "h-4 w-4 rounded-full border-2 transition-all",
                      hlColor === c ? "border-slate-900 scale-110" : "border-transparent",
                    )}
                    style={{ backgroundColor: HL_BG[c] }}
                  />
                ))}
                <button
                  onClick={() => applyHighlight("erase", stemRef.current)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-slate-400 hover:bg-slate-100"
                  title="清除所选高亮"
                >
                  擦除
                </button>
              </div>
            )}
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
            <div
              key={cur.id}
              ref={stemRef}
              onMouseUp={() => onHighlightableMouseUp(stemRef.current)}
              className={cn("text-[17px] leading-relaxed mb-6 select-text", highlightActive && "cursor-text")}
            >
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

      {frqSubmitted ? (
        <>
          <h2 className="font-semibold mb-3">选择题（MCQ）详解</h2>
          <div className="space-y-3 mb-8">
            {questions.map((q, i) => {
              const picked = answers[q.id];
              const ok = picked === q.correct_answer;
              return (
                <Card key={q.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-bold">#{i + 1}</span>
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded",
                          ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                        )}
                      >
                        {ok ? "正确" : picked ? "错误" : "未作答"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        你的答案：{picked ?? "—"}　正确答案：{q.correct_answer}
                      </span>
                    </div>
                    <div className="text-sm leading-relaxed">
                      {renderStemWithTerms(q.stem, q.term_tags ?? [], termDict)}
                    </div>
                    <details className="text-sm">
                      <summary className="cursor-pointer text-primary text-xs">查看解析</summary>
                      <div className="mt-2 p-3 bg-muted rounded text-xs whitespace-pre-wrap leading-relaxed">
                        {renderStemWithTerms(q.explanation, q.term_tags ?? [], termDict)}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {frqs.length > 0 && (
            <>
              <h2 className="font-semibold mb-3">简答题（FRQ）· AI 评分</h2>
              <div className="space-y-3 mb-6">
                {frqs.map((f, i) => {
                  const grade = frqGrades[f.id];
                  const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
                  return (
                    <Card key={f.id}>
                      <CardContent className="p-5 space-y-3">
                        <div className="font-semibold">
                          Question {i + 1}
                          {f.title ? ` · ${f.title}` : ""}
                          <span className="ml-2 text-xs text-muted-foreground">满分 {f.max_score} 分</span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{f.content}</p>
                        {ans.text && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground">你的作答</summary>
                            <pre className="mt-2 p-2 bg-muted rounded whitespace-pre-wrap text-[12px]">{ans.text}</pre>
                          </details>
                        )}
                        {ans.fileUrl && (
                          <a
                            href={ans.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary underline"
                          >
                            查看上传文件
                          </a>
                        )}
                        {grade ? (
                          <FrqGradeCard grade={grade} />
                        ) : ans.text.trim() || ans.fileUrl ? (
                          <p className="text-xs text-destructive">已作答，但 AI 评分未完成，请返回重试。</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">本题未提交作答，未评分。</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">提交 FRQ 后将显示 MCQ 解析与 FRQ 评分。</p>
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

function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string>("");
  const press = (s: string) => setExpr((e) => e + s);
  const evalExpr = () => {
    try {
      // 仅允许数字与基本运算符
      const safe = expr.replace(/[^0-9+\-*/().√ ]/g, "").replace(/√/g, "Math.sqrt");
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict"; return (${safe})`)();
      setResult(String(v));
    } catch {
      setResult("Error");
    }
  };
  const keys = [
    ["(", ")", "√", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    ["0", ".", "ans", "="],
  ];
  const map: Record<string, string> = { "÷": "/", "×": "*", "−": "-" };
  return (
    <div className="fixed top-20 right-6 z-[55] w-[340px] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-900 text-white px-3 py-2 flex items-center justify-between">
        <span className="font-semibold text-sm">Calculator</span>
        <button onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
      <div className="p-3 space-y-2 bg-slate-50">
        <div className="h-9 bg-white border border-slate-300 rounded px-2 text-right text-sm font-mono flex items-center justify-end overflow-x-auto">{expr || "\u00A0"}</div>
        <div className="h-12 bg-white border-2 border-blue-600 rounded px-2 text-right text-lg font-mono flex items-center justify-end overflow-x-auto">{result || "\u00A0"}</div>
        <div className="flex items-center justify-between px-1">
          <button onClick={() => setExpr("")} className="text-xs text-slate-600 hover:text-slate-900">clear all</button>
          <button onClick={() => setExpr((e) => e.slice(0, -1))} className="text-slate-600 hover:text-slate-900"><Delete className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {keys.flat().map((k) => {
            const isOp = ["÷", "×", "−", "+", "=", "√", "(", ")"].includes(k);
            return (
              <button
                key={k}
                onClick={() => {
                  if (k === "=") return evalExpr();
                  if (k === "ans") return setExpr((e) => e + result);
                  press(map[k] ?? k);
                }}
                className={cn(
                  "h-10 rounded text-sm font-semibold",
                  k === "=" ? "bg-blue-600 text-white hover:bg-blue-700" : isOp ? "bg-white border border-slate-300 hover:bg-slate-100" : "bg-slate-200 hover:bg-slate-300",
                )}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}