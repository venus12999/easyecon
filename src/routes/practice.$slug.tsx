import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { renderStemWithTerms, highlightTermsInNodes, type TermInfo } from "@/lib/term-render";
import { optionStyles, colorizeExplanation, type OptKey } from "@/lib/option-colors";
import { AskAi } from "@/components/AskAi";
import { recordAnswer, addWrong, getWrong } from "@/lib/storage";
import { recordAnswer as recordMascotAnswer } from "@/lib/mascot-memory";
import { reportAnswerEvent } from "@/lib/mascot-coach";
import { Check, X, ChevronLeft, ChevronRight, Bookmark, Loader2, Home } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { playCorrect, playWrong } from "@/lib/sfx";

const searchSchema = z.object({
  type: z.enum(["basic", "application", "pitfall"]).optional(),
  qid: z.string().optional(),
});

export const Route = createFileRoute("/practice/$slug")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "刷题 · AP 微观经济" },
      { name: "description", content: "AP Microeconomics MCQ 练习，含中文解析与 AI 追问。" },
    ],
  }),
  component: Practice,
});

type Q = {
  id: string;
  knowledge_point_id: string;
  type: "basic" | "application" | "pitfall";
  difficulty: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string | null;
  correct_answer: OptKey;
  explanation: string;
  pitfall_note: string | null;
  term_tags: string[] | null;
  image_url: string | null;
};
type Kp = { id: string; slug: string; name_en: string; name_zh: string };

function Practice() {
  const { slug } = Route.useParams();
  const { type } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [kp, setKp] = useState<Kp | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<OptKey | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [loading, setLoading] = useState(true);
  const [wrongSet, setWrongSet] = useState<Set<string>>(new Set());
  const [session, setSession] = useState({ total: 0, correct: 0, streak: 0 });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: kpData } = await supabase
        .from("knowledge_points")
        .select("id,slug,name_en,name_zh")
        .eq("slug", slug)
        .maybeSingle();
      if (!kpData) {
        setLoading(false);
        return;
      }
      let q = supabase
        .from("questions")
        .select("*")
        .eq("knowledge_point_id", kpData.id)
        .eq("status", "published")
        .eq("exclude_from_pool", false)
        .order("difficulty");
      if (type) q = q.eq("type", type);
      const { data: qData } = await q;
      const { data: tData } = await supabase.from("terms").select("term_en,term_zh,definition,confusable_with");
      const dict: Record<string, TermInfo> = {};
      (tData ?? []).forEach((t) => {
        dict[t.term_en.toLowerCase()] = t as TermInfo;
      });
      setKp(kpData as Kp);
      setQuestions((qData ?? []) as Q[]);
      setTermDict(dict);
      setIdx(0);
      setPicked(null);
      setSubmitted(false);
      // Load existing wrong-book to dedupe the bookmark button
      if (user) {
        const { data: wrongs } = await supabase
          .from("wrong_questions")
          .select("question_id")
          .eq("user_id", user.id)
          .eq("source", "practice");
        setWrongSet(new Set((wrongs ?? []).map((r) => r.question_id)));
      } else {
        setWrongSet(new Set(getWrong()));
      }
      setLoading(false);
    })();
  }, [slug, type, user]);

  const cur = questions[idx];

  async function submit() {
    if (!picked || !cur) return;
    setSavingAnswer(true);
    const ok = picked === cur.correct_answer;
    if (ok) playCorrect(); else playWrong();
    recordAnswer(cur.knowledge_point_id, ok);
    recordMascotAnswer({ knowledgePointId: cur.knowledge_point_id, isCorrect: ok });
    const next = {
      total: session.total + 1,
      correct: session.correct + (ok ? 1 : 0),
      streak: ok ? session.streak + 1 : 0,
    };
    setSession(next);
    reportAnswerEvent({
      isCorrect: ok,
      currentStreakCorrect: next.streak,
      sessionTotal: next.total,
      sessionCorrect: next.correct,
    });
    if (!ok && !wrongSet.has(cur.id)) addWrong(cur.id);
    if (user) {
      await supabase.from("answer_attempts").insert({
        user_id: user.id,
        question_id: cur.id,
        knowledge_point_id: cur.knowledge_point_id,
        picked_answer: picked,
        is_correct: ok,
        mode: "practice",
      });
      if (!ok && !wrongSet.has(cur.id)) {
        await supabase.from("wrong_questions").upsert(
          { user_id: user.id, question_id: cur.id, source: "practice" },
          { onConflict: "user_id,question_id,source" },
        );
        setWrongSet((s) => new Set(s).add(cur.id));
      }
    } else if (!ok) {
      setWrongSet((s) => new Set(s).add(cur.id));
    }
    setSubmitted(true);
    setSavingAnswer(false);
  }
  async function finishPractice() {
    if (picked && !submitted) await submit();
    void navigate({ to: "/" });
  }
  function next() {
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
      setPicked(null);
      setSubmitted(false);
    }
  }
  function prev() {
    if (idx > 0) {
      setIdx(idx - 1);
      setPicked(null);
      setSubmitted(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        
        <main className="mx-auto max-w-3xl px-4 py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </main>
      </div>
    );
  }
  if (!kp) {
    return (
      <div className="min-h-screen">
        
        <main className="mx-auto max-w-3xl px-4 py-12 text-center">
          <p>知识点不存在</p>
          <Link to="/" className="text-primary underline mt-2 inline-block">返回首页</Link>
        </main>
      </div>
    );
  }
  if (questions.length === 0) {
    return (
      <div className="min-h-screen">
        
        <main className="mx-auto max-w-3xl px-4 py-12 text-center">
          <h1 className="text-xl font-semibold">{kp.name_zh} · {kp.name_en}</h1>
          <p className="mt-3 text-muted-foreground">该题型下暂无已发布题目。</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/">返回知识点</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← 返回知识点</Link>
            <Button type="button" variant="outline" size="sm" onClick={finishPractice} disabled={savingAnswer}>
              <Home className="h-4 w-4 mr-1" />结束练习
            </Button>
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{kp.name_en}</div>
            <h1 className="text-lg font-semibold">{kp.name_zh}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {idx + 1} / {questions.length}
          </div>
        </div>
        <Progress value={((idx + 1) / questions.length) * 100} className="mb-6" />

        <QuestionCard
          q={cur!}
          picked={picked}
          submitted={submitted}
          onPick={setPicked}
          termDict={termDict}
        />

        <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="outline" onClick={prev} disabled={idx === 0}>
            <ChevronLeft className="h-4 w-4" /> 上一题
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!cur || wrongSet.has(cur.id)}
            onClick={async () => {
              if (!cur || wrongSet.has(cur.id)) return;
              addWrong(cur.id);
              if (user) {
                await supabase.from("wrong_questions").upsert(
                  { user_id: user.id, question_id: cur.id, source: "practice" },
                  { onConflict: "user_id,question_id,source" },
                );
              }
              setWrongSet((s) => new Set(s).add(cur.id));
              toast.success("已加入错题本");
            }}
          >
            <Bookmark className="h-4 w-4" /> {cur && wrongSet.has(cur.id) ? "已在错题本" : "加入错题本"}
          </Button>
          {!submitted ? (
            <Button onClick={submit} disabled={!picked || savingAnswer}>{savingAnswer ? "保存中…" : "提交"}</Button>
          ) : (
            idx === questions.length - 1 ? (
              <Button type="button" onClick={finishPractice}>
                <Home className="h-4 w-4 mr-1" />完成 · 返回主页
              </Button>
            ) : (
              <Button onClick={next}>
                下一题 <ChevronRight className="h-4 w-4" />
              </Button>
            )
          )}
        </div>
      </main>
    </div>
  );
}

function QuestionCard({
  q,
  picked,
  submitted,
  onPick,
  termDict,
}: {
  q: Q;
  picked: OptKey | null;
  submitted: boolean;
  onPick: (v: OptKey) => void;
  termDict: Record<string, TermInfo>;
}) {
  const opts: Array<{ k: OptKey; v: string }> = [
    { k: "A", v: q.option_a },
    { k: "B", v: q.option_b },
    { k: "C", v: q.option_c },
    { k: "D", v: q.option_d },
    ...(q.option_e ? [{ k: "E" as OptKey, v: q.option_e }] : []),
  ];
  const tags = q.term_tags ?? [];
  const correct = q.correct_answer;

  return (
    <>
      <Card>
        <CardContent className="p-6 space-y-5">
          <p className="text-base leading-relaxed">
            {renderStemWithTerms(q.stem, tags, termDict)}
          </p>
          {q.image_url && (
            <img
              src={q.image_url}
              alt="题目配图"
              className="max-h-80 w-auto rounded-md border border-border bg-muted/30"
            />
          )}
          <div className="space-y-2">
            {opts.map((o) => {
              const isPicked = picked === o.k;
              const isCorrect = submitted && o.k === correct;
              const isWrongPick = submitted && isPicked && o.k !== correct;
              const s = optionStyles[o.k];
              return (
                <button
                  key={o.k}
                  type="button"
                  disabled={submitted}
                  onClick={() => onPick(o.k)}
                  className={[
                    "w-full text-left rounded-lg border-2 px-4 py-3 transition-all flex items-start gap-3",
                    submitted && !isCorrect && !isWrongPick ? "opacity-60" : "",
                  ].join(" ")}
                  style={{
                    borderColor: isCorrect
                      ? "var(--success)"
                      : isWrongPick
                        ? "var(--destructive)"
                        : isPicked
                          ? s.border
                          : "transparent",
                    background: isCorrect
                      ? "color-mix(in oklab, var(--success) 12%, transparent)"
                      : isWrongPick
                        ? "color-mix(in oklab, var(--destructive) 10%, transparent)"
                        : s.bgSoft,
                  }}
                >
                  <span
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{
                      background: isWrongPick
                        ? "var(--destructive)"
                        : isCorrect
                          ? "var(--success)"
                          : s.bg,
                    }}
                  >
                    {isCorrect ? <Check className="h-4 w-4" /> : isWrongPick ? <X className="h-4 w-4" /> : o.k}
                  </span>
                  <span className="flex-1 text-sm leading-relaxed pt-1" style={{ color: s.ink }}>
                    {renderStemWithTerms(o.v, tags, termDict)}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {submitted && (
        <>
          <Card className="mt-4 border-primary/30">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">解析</span>
                <span className="text-sm text-muted-foreground">
                  正确答案：
                  <span
                    className="font-bold rounded px-1.5 py-0.5"
                    style={{
                      background: optionStyles[correct].bg,
                      color: "white",
                    }}
                  >
                    {correct}
                  </span>
                </span>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {highlightTermsInNodes(colorizeExplanation(q.explanation), termDict)}
              </div>
              {q.pitfall_note && (
                <div className="rounded-md bg-warning/15 border border-warning/30 px-3 py-2 text-sm">
                  {renderStemWithTerms(q.pitfall_note, tags, termDict)}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="mt-4">
            <AskAi q={q} />
          </div>
        </>
      )}
    </>
  );
}