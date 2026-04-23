import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { recordAnswer, addWrong, removeWrong } from "@/lib/storage";
import { Check, X, ChevronLeft, ChevronRight, Bookmark, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

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
  correct_answer: "A" | "B" | "C" | "D";
  explanation: string;
  pitfall_note: string | null;
  term_tags: string[] | null;
};
type Kp = { id: string; slug: string; name_en: string; name_zh: string };

function Practice() {
  const { slug } = Route.useParams();
  const { type } = Route.useSearch();
  const navigate = useNavigate();

  const [kp, setKp] = useState<Kp | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [termDict, setTermDict] = useState<Record<string, TermInfo>>({});
  const [loading, setLoading] = useState(true);

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
        .order("difficulty");
      if (type) q = q.eq("type", type);
      const { data: qData } = await q;
      const { data: tData } = await supabase.from("terms").select("term_en,term_zh,definition");
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
      setLoading(false);
    })();
  }, [slug, type]);

  const cur = questions[idx];

  function submit() {
    if (!picked || !cur) return;
    setSubmitted(true);
    const ok = picked === cur.correct_answer;
    recordAnswer(cur.knowledge_point_id, ok);
    if (!ok) addWrong(cur.id);
    else removeWrong(cur.id);
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
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </main>
      </div>
    );
  }
  if (!kp) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-12 text-center">
          <p>知识点不存在</p>
          <Link to="/" className="text-primary underline mt-2 inline-block">返回首页</Link>
        </main>
      </div>
    );
  }
  if (questions.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
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
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
        <div className="mb-4">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← 返回知识点</Link>
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
            onClick={() => {
              addWrong(cur!.id);
              toast.success("已加入错题本");
            }}
          >
            <Bookmark className="h-4 w-4" /> 标记
          </Button>
          {!submitted ? (
            <Button onClick={submit} disabled={!picked}>提交</Button>
          ) : (
            <Button onClick={next} disabled={idx === questions.length - 1}>
              下一题 <ChevronRight className="h-4 w-4" />
            </Button>
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
  picked: "A" | "B" | "C" | "D" | null;
  submitted: boolean;
  onPick: (v: "A" | "B" | "C" | "D") => void;
  termDict: Record<string, TermInfo>;
}) {
  const opts: Array<{ k: "A" | "B" | "C" | "D"; v: string }> = [
    { k: "A", v: q.option_a },
    { k: "B", v: q.option_b },
    { k: "C", v: q.option_c },
    { k: "D", v: q.option_d },
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
          <div className="space-y-2">
            {opts.map((o) => {
              const isPicked = picked === o.k;
              const isCorrect = submitted && o.k === correct;
              const isWrongPick = submitted && isPicked && o.k !== correct;
              return (
                <button
                  key={o.k}
                  type="button"
                  disabled={submitted}
                  onClick={() => onPick(o.k)}
                  className={[
                    "w-full text-left rounded-lg border px-4 py-3 transition-all flex items-start gap-3",
                    "hover:border-primary/50",
                    isPicked && !submitted ? "border-primary bg-primary/5" : "",
                    isCorrect ? "border-success bg-success/10" : "",
                    isWrongPick ? "border-destructive bg-destructive/10" : "",
                    submitted && !isCorrect && !isWrongPick ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-sm font-medium",
                      isCorrect ? "border-success text-success" : "",
                      isWrongPick ? "border-destructive text-destructive" : "",
                    ].join(" ")}
                  >
                    {isCorrect ? <Check className="h-4 w-4" /> : isWrongPick ? <X className="h-4 w-4" /> : o.k}
                  </span>
                  <span className="flex-1 text-sm leading-relaxed pt-0.5">
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
                <span className="text-sm text-muted-foreground">正确答案：{correct}</span>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {q.explanation}
              </div>
              {q.pitfall_note && (
                <div className="rounded-md bg-warning/15 border border-warning/30 px-3 py-2 text-sm">
                  {q.pitfall_note}
                </div>
              )}
            </CardContent>
          </Card>
          <AskAi q={q} />
        </>
      )}
    </>
  );
}

function AskAi({ q }: { q: Q }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!input.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch("/api/ai-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: input,
          context: {
            stem: q.stem,
            options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
            correct: q.correct_answer,
            explanation: q.explanation,
          },
        }),
      });
      if (!res.ok || !res.body) {
        if (res.status === 429) {
          toast.error("AI 请求过于频繁，请稍后再试");
        } else if (res.status === 402) {
          toast.error("AI 额度已用完，请联系管理员充值");
        } else {
          toast.error("AI 暂不可用");
        }
        setLoading(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) setAnswer((a) => a + c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e) {
      toast.error("AI 请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-4 border-accent/40 bg-accent/5">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">还有疑问？问 AI</span>
          <span className="text-xs text-muted-foreground">（仅解释，不会修改正确答案）</span>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例：为什么不选 B？shift 和 movement 区别是什么？"
          rows={2}
        />
        <div className="flex justify-end">
          <Button onClick={ask} disabled={loading || !input.trim()} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "提问"}
          </Button>
        </div>
        {answer && (
          <div className="rounded-md bg-background border p-3 text-sm whitespace-pre-wrap leading-relaxed">
            {answer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}