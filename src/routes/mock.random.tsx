import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { recordAnswer } from "@/lib/storage";
import { recordAnswer as recordMascotAnswer, recordFrqSubmission, recordMockAttempt } from "@/lib/mascot-memory";
import { Clock, Loader2, SquarePen } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { FrqAnswerBox, EMPTY_ANSWER, type FrqAnswerState } from "@/components/frq/FrqAnswerBox";
import { FrqGradeCard, type GradeResult } from "@/components/frq/FrqGradeCard";
import { FrqContent } from "@/components/frq/FrqContent";
import { Button as UiButton } from "@/components/ui/button";

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
  image_url: string | null;
  knowledge_points: { name_zh: string; unit: number } | null;
};

type FrqItem = {
  id: string;
  title: string | null;
  content: string;
  image_url: string | null;
  image_text: string | null;
  max_score: number;
  sort_order: number;
  paper_id: string;
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
  const [phase, setPhase] = useState<"idle" | "running" | "frq" | "done">("idle");
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, OptKey>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [shortageNote, setShortageNote] = useState<string | null>(null);
  const [frqs, setFrqs] = useState<FrqItem[]>([]);
  const [frqAnswers, setFrqAnswers] = useState<Record<string, FrqAnswerState>>({});
  const [frqGrades, setFrqGrades] = useState<Record<string, GradeResult>>({});
  const [grading, setGrading] = useState<Record<string, boolean>>({});

  // 官方 AP 微观考试：60 题 / 70 分钟
  const TOTAL_QUESTIONS = 60;
  const TIME_LIMIT_SECONDS = 70 * 60;
  // AP 微观考试 Section II 共 3 题：1 道长题 + 2 道短题
  const FRQ_COUNT = 3;
  // 每个 Unit 的目标题数（均落在官方比例区间内，合计 60）
  // U1 13.3% / U2 23.3% / U3 20% / U4 18.3% / U5 11.7% / U6 13.3%
  const UNIT_TARGETS: Record<number, number> = { 1: 8, 2: 14, 3: 12, 4: 11, 5: 7, 6: 8 };
  const remainingSeconds = Math.max(0, TIME_LIMIT_SECONDS - seconds);
  const timeUp = phase === "running" && remainingSeconds === 0;

  useEffect(() => {
    supabase
      .from("terms")
      .select("term_en,term_zh,definition,confusable_with")
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
    if (!user) {
      toast.error("请先登录后参加完整模考");
      return;
    }
    setLoading(true);
    setShortageNote(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setLoading(false);
      toast.error("登录状态已过期，请重新登录");
      return;
    }
    const accessResponse = await fetch("/api/membership/mock-access?exam_key=random-full", { headers: { Authorization: `Bearer ${token}` } });
    const access = await accessResponse.json().catch(() => ({}));
    if (!accessResponse.ok || !access.allowed) {
      setLoading(false);
      const date = access.nextAvailableAt ? new Date(access.nextAvailableAt).toLocaleString() : null;
      toast.error(date ? `免费用户下次可于 ${date} 参加模考` : "免费用户每 7 天可参加 1 次模考，可在个人资料页升级会员");
      return;
    }
    const { data } = await supabase
      .from("questions")
      .select("id,knowledge_point_id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,image_url,term_tags,knowledge_points!inner(name_zh,unit)")
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

    // 抽取 3 道 FRQ（1 长 + 2 短，按 max_score 分组）
    const { data: poolPaper } = await supabase
      .from("mock_papers")
      .select("id")
      .eq("slug", "frq-pdf-practice")
      .maybeSingle();
    if (poolPaper) {
      const { data: allFrqs } = await supabase
        .from("paper_frqs")
        .select("id,title,content,image_url,image_text,max_score,sort_order")
        .eq("paper_id", poolPaper.id);
      const list = ((allFrqs ?? []) as Omit<FrqItem, "paper_id">[]).map((f) => ({
        ...f,
        paper_id: poolPaper.id,
      }));
      const longs = shuffle(list.filter((f) => f.max_score >= 8));
      const shorts = shuffle(list.filter((f) => f.max_score < 8));
      const pickedFrqs: FrqItem[] = [];
      if (longs[0]) pickedFrqs.push(longs[0]);
      pickedFrqs.push(...shorts.slice(0, FRQ_COUNT - pickedFrqs.length));
      // 兜底：题型不足时再从剩余里补齐
      if (pickedFrqs.length < FRQ_COUNT) {
        const usedIds = new Set(pickedFrqs.map((f) => f.id));
        pickedFrqs.push(
          ...shuffle(list.filter((f) => !usedIds.has(f.id))).slice(
            0,
            FRQ_COUNT - pickedFrqs.length,
          ),
        );
      }
      setFrqs(pickedFrqs);
    } else {
      setFrqs([]);
    }
    setFrqAnswers({});
    setFrqGrades({});
    setPhase("running");
    setLoading(false);
  }

  function submit() {
    questions.forEach((q) => {
      const a = answers[q.id];
      const ok = a === q.correct_answer;
      recordAnswer(q.knowledge_point_id, ok);
      recordMascotAnswer({ knowledgePointId: q.knowledge_point_id, isCorrect: ok });
    });
    recordMockAttempt();
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
    if (frqs.length > 0) setPhase("frq");
    else setPhase("done");
  }

  async function gradeOneFrq(f: FrqItem): Promise<boolean> {
    const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
    if (!ans.text.trim() && !ans.fileUrl) return true;
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
          paper_id: f.paper_id,
          mode: "exam",
          answer_text: ans.text || null,
          answer_file_url: ans.fileUrl,
          answer_file_kind: ans.fileKind,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const message =
          j.error === "membership_quota_exhausted"
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
    let ok = true;
    for (const f of frqs) {
      if (!frqGrades[f.id]) {
        const succeeded = await gradeOneFrq(f);
        if (!succeeded) ok = false;
      }
    }
    if (!ok) {
      toast.error("部分作答尚未评分，请重试后再查看结果");
      return;
    }
    const submittedCount = frqs.filter((f) => {
      const a = frqAnswers[f.id];
      return a && (a.text.trim() || a.fileUrl);
    }).length;
    for (let i = 0; i < submittedCount; i++) recordFrqSubmission();
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
            按 AP 微观经济考试规格随机抽取 <b>60 道</b> 多选题（限时 <b>70 分钟</b>，时间到自动交卷），
            随后进入 Section II 大题：<b>1 道长题 + 2 道短题</b>，AI 按 rubric 评分。
          </p>
          <Card className="mb-4 border-primary/30 bg-primary/5">
            <CardContent className="p-4 space-y-1.5 text-sm">
              <div className="font-semibold text-primary">Section II · 大题（AP 官方比例）</div>
              <div className="text-muted-foreground text-xs leading-relaxed">
                选择题交卷后将自动进入大题阶段，从大题题库随机抽取 <b>1 道长题（≥8 分）</b> + <b>2 道短题</b>，
                作答后由 AI 按 rubric 逐点评分，并给出改进建议。
              </div>
              <div className="text-[11px] text-muted-foreground">
                提示：免费用户每 7 天可参加 1 次完整模考；如已用尽冷却，可在个人资料页升级会员。
              </div>
            </CardContent>
          </Card>
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

  if (phase === "frq") {
    const allGrading = Object.values(grading).some(Boolean);
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <SquarePen className="h-4 w-4" /> Section II · FRQ
            </div>
            <h1 className="mt-1 text-2xl font-bold">大题部分（1 长 + 2 短）</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              按 AP 考试规格作答，提交后 AI 将按官方得分点评分。
            </p>
          </div>
          {frqs.map((f, i) => {
            const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
            const grade = frqGrades[f.id];
            return (
              <Card key={f.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="font-semibold">
                    Question {i + 1}
                    {f.title ? ` · ${f.title}` : ""}
                    <span className="ml-2 text-xs text-muted-foreground">
                      满分 {f.max_score} 分
                    </span>
                  </div>
                  <FrqContent content={f.content} />
                  <FrqAnswerBox
                    paperId={f.paper_id}
                    frqId={f.id}
                    value={ans}
                    onChange={(v) => setFrqAnswers((s) => ({ ...s, [f.id]: v }))}
                    disabled={!!grade}
                  />
                  {!grade && (
                    <UiButton
                      size="sm"
                      variant="outline"
                      onClick={() => void gradeOneFrq(f)}
                      disabled={grading[f.id] || (!ans.text.trim() && !ans.fileUrl)}
                    >
                      {grading[f.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      单独评分本题
                    </UiButton>
                  )}
                  {grade && <FrqGradeCard grade={grade} />}
                  {grade && (
                    <UiButton
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setFrqGrades((g) => {
                          const n = { ...g };
                          delete n[f.id];
                          return n;
                        });
                        setFrqAnswers((s) => ({ ...s, [f.id]: EMPTY_ANSWER }));
                        toast.success("已清空作答，可重新答题");
                      }}
                    >
                      重新作答本题
                    </UiButton>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <div className="flex justify-end">
            <UiButton onClick={() => void submitAllFrqs()} disabled={allGrading}>
              {allGrading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              完成大题并查看全部成绩
            </UiButton>
          </div>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{idx + 1} / {questions.length}</span>
              {frqs.length > 0 && (
                <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
                  Section II 待命 · {frqs.length} 道大题
                </span>
              )}
            </div>
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
              {cur.image_url && (
                <img
                  src={cur.image_url}
                  alt="题图"
                  className="max-h-80 w-auto rounded border border-border"
                />
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
            <div className="flex items-center gap-2">
              {idx < questions.length - 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`确认提前交卷？已作答 ${Object.keys(answers).length}/${questions.length}，未答按错处理，随后进入 Section II 大题。`)) submit();
                  }}
                >
                  提前交卷 → 大题
                </Button>
              )}
              {idx < questions.length - 1 ? (
                <Button onClick={() => setIdx(idx + 1)}>下一题</Button>
              ) : (
                <Button onClick={submit}>交卷 → 进入大题</Button>
              )}
            </div>
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

        {frqs.length > 0 && (
          <>
            <h2 className="font-semibold mb-3">FRQ · AI 评分</h2>
            <div className="space-y-3 mb-6">
              {frqs.map((f, i) => {
                const grade = frqGrades[f.id];
                const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
                return (
                  <Card key={f.id}>
                    <CardContent className="p-5 space-y-3">
                      <div className="font-semibold text-sm">
                        Question {i + 1}
                        {f.title ? ` · ${f.title}` : ""}
                        <span className="ml-2 text-xs text-muted-foreground">
                          满分 {f.max_score} 分
                        </span>
                      </div>
                      {ans.text && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            你的作答
                          </summary>
                          <pre className="mt-2 p-2 bg-muted rounded whitespace-pre-wrap text-[12px]">
                            {ans.text}
                          </pre>
                        </details>
                      )}
                      {grade ? (
                        <FrqGradeCard grade={grade} />
                      ) : (
                        <p className="text-xs text-muted-foreground">本题未提交，未评分。</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

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