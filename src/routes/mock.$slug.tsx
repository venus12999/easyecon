import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { renderStemWithTerms, type TermInfo } from "@/lib/term-render";
import { optionStyles, type OptKey } from "@/lib/option-colors";
import { recordAnswer } from "@/lib/storage";
import { recordAnswer as recordMascotAnswer, recordFrqSubmission, recordMockAttempt } from "@/lib/mascot-memory";
import { Loader2, ArrowLeft, Bookmark, ChevronDown, ChevronUp, X, MoreVertical, Highlighter, Calculator as CalcIcon, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { FrqAnswerBox, EMPTY_ANSWER, type FrqAnswerState } from "@/components/frq/FrqAnswerBox";
import { FrqGradeCard, type GradeResult } from "@/components/frq/FrqGradeCard";
import { FrqContent } from "@/components/frq/FrqContent";
import { McqResultGrid } from "@/components/mock/McqResultGrid";
import {
  CalculatorModal,
  HighlightColorBar,
  HighlightRemoveMenu,
  unwrapHighlightSpan,
  useExamHighlights,
} from "@/components/mock/exam-tools";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { FRQ_CATEGORIES, getFrqUnit } from "@/lib/frq-categories";
import { MockResultAuthGate } from "@/components/AuthGateCard";
import { clearPendingMock, loadPendingMock, savePendingMock } from "@/lib/pending-mock";
import { consumeMockAccess } from "@/lib/mock-access-client";

export const Route = createFileRoute("/mock/$slug")({
  head: () => ({ meta: [{ title: "真题卷 · AP 微观经济" }] }),
  validateSearch: (search: Record<string, unknown>): { unit?: number; frq?: string } => {
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
  const [phase, setPhase] = useState<"idle" | "running" | "break" | "frq" | "authGate" | "done">("idle");
  const [revealError, setRevealError] = useState(false);
  const revealingRef = useRef(false);
  const pendingRestoredRef = useRef(false);
  const mcqPersistedRef = useRef(false);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [frqSeconds, setFrqSeconds] = useState(0);
  const [frqAnswers, setFrqAnswers] = useState<Record<string, FrqAnswerState>>({});
  const [frqGrades, setFrqGrades] = useState<Record<string, GradeResult>>({});
  const [grading, setGrading] = useState<Record<string, boolean>>({});
  const [frqSubmitted, setFrqSubmitted] = useState(false);
  const [draftSaving, setDraftSaving] = useState<Record<string, boolean>>({});
  const [draftSavedAt, setDraftSavedAt] = useState<Record<string, number>>({});
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(false);
  const [restarting, setRestarting] = useState(false);
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
  const [highContrast, setHighContrast] = useState(false);
  const [lineReader, setLineReader] = useState(false);
  const [lineY, setLineY] = useState(120);
  const {
    stemRef,
    highlightActive,
    setHighlightActive,
    hlColor,
    setHlColor,
    hlRemove,
    setHlRemove,
    onHighlightableMouseUp,
    onHighlightClick,
    consumePendingHighlightClick,
  } = useExamHighlights(idx);

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
    if (loading) return;
    if (!pendingRestoredRef.current) {
      const pending = loadPendingMock();
      if (pending?.kind === "paper" && pending.slug === slug) {
        pendingRestoredRef.current = true;
        setMode(pending.mode);
        setAnswers(pending.answers as Record<string, OptKey>);
        setSeconds(pending.seconds);
        setFrqAnswers(pending.frqAnswers);
        setPhase("authGate");
        return;
      }
    }
    const isFrqOnly = slug === "frq-pdf-practice" || slug.startsWith("frq-pack-");
    if (isFrqOnly && phase === "idle" && frqs.length > 0) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, slug, phase, frqs.length]);

  // 加载已提交的评分与未提交的草稿，确保下次登录可继续
  useEffect(() => {
    if (!user || !paper || frqs.length === 0 || phase === "authGate" || phase === "done") {
      setDraftHydrated(true);
      return;
    }
    setDraftHydrated(false);
    const frqIds = frqs.map((f) => f.id);
    void Promise.all([
      supabase
        .from("frq_submissions")
        .select("frq_id,ai_score,ai_max_score,ai_breakdown,ai_overall,ai_suggestions,answer_text,answer_file_url,answer_file_kind,created_at")
        .eq("user_id", user.id)
        .eq("paper_id", paper.id)
        .in("frq_id", frqIds)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("frq_drafts")
        .select("frq_id,answer_text,answer_file_url,answer_file_kind,answer_file_name")
        .eq("user_id", user.id)
        .eq("paper_id", paper.id)
        .in("frq_id", frqIds),
    ]).then(([subRes, draftRes]) => {
      const grades: Record<string, GradeResult> = {};
      const answersFromSubs: Record<string, FrqAnswerState> = {};
      const submitted = new Set<string>();
      ((subRes.data ?? []) as Array<{
        frq_id: string;
        ai_score: number | null;
        ai_max_score: number | null;
        ai_breakdown: GradeResult["breakdown"] | null;
        ai_overall: string | null;
        ai_suggestions: string | null;
        answer_text: string | null;
        answer_file_url: string | null;
        answer_file_kind: FrqAnswerState["fileKind"];
      }>).forEach((r) => {
        if (submitted.has(r.frq_id)) return;
        submitted.add(r.frq_id);
        if (r.ai_score != null && r.ai_max_score != null) {
          grades[r.frq_id] = {
            total_score: r.ai_score,
            max_score: r.ai_max_score,
            breakdown: r.ai_breakdown ?? [],
            overall_comment: r.ai_overall ?? "",
            suggestions: r.ai_suggestions ?? "",
          };
        }
        answersFromSubs[r.frq_id] = {
          text: r.answer_text ?? "",
          fileUrl: r.answer_file_url,
          fileKind: r.answer_file_kind,
          fileName: null,
        };
      });
      const answersFromDrafts: Record<string, FrqAnswerState> = {};
      ((draftRes.data ?? []) as Array<{
        frq_id: string;
        answer_text: string | null;
        answer_file_url: string | null;
        answer_file_kind: FrqAnswerState["fileKind"];
        answer_file_name: string | null;
      }>).forEach((r) => {
        if (submitted.has(r.frq_id)) return;
        answersFromDrafts[r.frq_id] = {
          text: r.answer_text ?? "",
          fileUrl: r.answer_file_url,
          fileKind: r.answer_file_kind,
          fileName: r.answer_file_name,
        };
      });
      setFrqGrades(grades);
      setFrqAnswers({ ...answersFromSubs, ...answersFromDrafts });
      setDraftHydrated(true);
      const hasDraft = Object.keys(answersFromDrafts).length > 0;
      if (hasDraft) toast.success("已恢复上次未完成的草稿");
      const allGraded = frqs.length > 0 && frqs.every((f) => grades[f.id]);
      if (allGraded) setRestartPrompt(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, paper?.id, frqs.length, phase]);

  async function restartAllFrqs() {
    if (!user || !paper) return;
    setRestarting(true);
    const frqIds = frqs.map((f) => f.id);
    await supabase
      .from("frq_submissions")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("paper_id", paper.id)
      .in("frq_id", frqIds)
      .is("archived_at", null);
    await supabase
      .from("frq_drafts")
      .delete()
      .eq("user_id", user.id)
      .eq("paper_id", paper.id)
      .in("frq_id", frqIds);
    setFrqGrades({});
    setFrqAnswers({});
    setDraftSavedAt({});
    setFrqSubmitted(false);
    setRestarting(false);
    setRestartPrompt(false);
    toast.success("已清空作答与分数，旧记录已存入历史");
  }

  // 自动保存草稿（去抖 800ms）
  useEffect(() => {
    if (!user || !paper || !draftHydrated || phase !== "frq") return;
    const handles: Array<ReturnType<typeof setTimeout>> = [];
    frqs.forEach((f) => {
      if (frqGrades[f.id]) return; // 已评分不再保存草稿
      const ans = frqAnswers[f.id];
      if (!ans) return;
      const t = setTimeout(() => {
        setDraftSaving((s) => ({ ...s, [f.id]: true }));
        const hasContent = !!(ans.text?.trim() || ans.fileUrl);
        if (!hasContent) {
          void supabase
            .from("frq_drafts")
            .delete()
            .eq("user_id", user.id)
            .eq("frq_id", f.id)
            .then(() => {
              setDraftSaving((s) => ({ ...s, [f.id]: false }));
            });
        } else {
          void supabase
            .from("frq_drafts")
            .upsert(
              {
                user_id: user.id,
                paper_id: paper.id,
                frq_id: f.id,
                answer_text: ans.text || null,
                answer_file_url: ans.fileUrl,
                answer_file_kind: ans.fileKind,
                answer_file_name: ans.fileName,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,frq_id" },
            )
            .then(({ error }) => {
              setDraftSaving((s) => ({ ...s, [f.id]: false }));
              if (!error) setDraftSavedAt((s) => ({ ...s, [f.id]: Date.now() }));
            });
        }
      }, 800);
      handles.push(t);
    });
    return () => handles.forEach((h) => clearTimeout(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frqAnswers, draftHydrated, phase, user?.id, paper?.id]);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (timeUp) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  function beginPaper() {
    setAnswers({});
    setIdx(0);
    setSeconds(0);
    mcqPersistedRef.current = false;
    revealingRef.current = false;
    setRevealError(false);
    // 仅当存在选择题（即非 FRQ-only 卷）时清空 FRQ 状态；
    // FRQ 整卷会从草稿与已有评分恢复，不能清空
    if (questions.length > 0) {
      setFrqAnswers({});
      setFrqGrades({});
    }
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

  async function start() {
    const isFrqOnly = slug === "frq-pdf-practice" || slug.startsWith("frq-pack-");
    if (user && !isFrqOnly) {
      const access = await consumeMockAccess(slug, "start");
      if (!access.ok) {
        toast.error(access.message);
        return;
      }
    }
    clearPendingMock();
    beginPaper();
  }

  function persistPendingPaper() {
    savePendingMock({
      kind: "paper",
      slug,
      mode,
      answers,
      seconds,
      frqAnswers,
    });
  }

  function persistMcqCloud(userId: string) {
    if (mcqPersistedRef.current || questions.length === 0) return;
    mcqPersistedRef.current = true;
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
      user_id: userId,
      total,
      correct,
      duration_seconds: seconds,
      detail,
      paper_slug: slug,
      paper_title: paper?.title ?? null,
      mode: "paper",
    });
    const rows = questions
      .filter((q) => !!answers[q.id])
      .map((q) => ({
        user_id: userId,
        question_id: q.id,
        knowledge_point_id: q.knowledge_point_id,
        picked_answer: answers[q.id],
        is_correct: answers[q.id] === q.correct_answer,
        mode: "mock",
      }));
    if (rows.length > 0) void supabase.from("answer_attempts").insert(rows);
    questions.forEach((q) => {
      if (answers[q.id]) recordMascotAnswer({ knowledgePointId: q.knowledge_point_id, isCorrect: answers[q.id] === q.correct_answer });
    });
    recordMockAttempt();
    const wrongRows = questions
      .filter((q) => !!answers[q.id] && answers[q.id] !== q.correct_answer)
      .map((q) => ({ user_id: userId, question_id: q.id, source: "mock" }));
    if (wrongRows.length > 0) {
      void supabase.from("wrong_questions").upsert(wrongRows, {
        onConflict: "user_id,question_id,source",
      });
    }
  }

  function submit() {
    questions.forEach((q) => {
      const a = answers[q.id];
      const ok = a === q.correct_answer;
      recordAnswer(q.knowledge_point_id, ok);
    });
    if (user) persistMcqCloud(user.id);
    // 有 FRQ 则进入大题阶段；仿真模式先走休息，练习模式直接进 FRQ
    if (frqs.length > 0) {
      setPhase(mode === "exam" ? "break" : "frq");
    } else if (!user) {
      persistPendingPaper();
      setPhase("authGate");
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
    return await runGradeOneFrq(f);
  }

  async function redoFrq(f: Frq) {
    if (!paper) return;
    setFrqGrades((g) => {
      const n = { ...g };
      delete n[f.id];
      return n;
    });
    setFrqAnswers((s) => ({ ...s, [f.id]: EMPTY_ANSWER }));
    if (user) {
      await supabase
        .from("frq_submissions")
        .delete()
        .eq("user_id", user.id)
        .eq("paper_id", paper.id)
        .eq("frq_id", f.id);
      await supabase
        .from("frq_drafts")
        .delete()
        .eq("user_id", user.id)
        .eq("frq_id", f.id);
    }
    toast.success("已清空作答，可重新答题");
  }

  async function runGradeOneFrq(f: Frq): Promise<boolean> {
    if (!paper) return false;
    const ans = frqAnswers[f.id] ?? EMPTY_ANSWER;
    if (!ans.text.trim() && !ans.fileUrl) return true; // 未作答跳过
    setGrading((g) => ({ ...g, [f.id]: true }));
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        persistPendingPaper();
        setPhase("authGate");
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
            : j.error === "ai_not_configured" || j.error === "server_misconfigured"
              ? "AI 评分尚未配置（需要 Gemini 接口密钥），请联系管理员"
            : j.error || "AI 评分失败，请稍后重试";
        toast.error(message);
        return false;
      }
      const grade = (await r.json()) as GradeResult;
      setFrqGrades((g) => ({ ...g, [f.id]: grade }));
      // 评分成功，删除草稿
      if (user) {
        void supabase
          .from("frq_drafts")
          .delete()
          .eq("user_id", user.id)
          .eq("frq_id", f.id);
      }
      return true;
    } catch {
      toast.error("AI 评分失败，请检查网络后重试");
      return false;
    } finally {
      setGrading((g) => ({ ...g, [f.id]: false }));
    }
  }

  async function submitAllFrqs() {
    const unfinished = frqs.filter((f) => {
      const a = frqAnswers[f.id];
      return !(a && (a.text.trim() || a.fileUrl));
    });
    if (unfinished.length > 0 && !(mode === "exam" && frqSeconds <= 0)) {
      toast.error(`请先写完全部 ${frqs.length} 道大题再交卷`);
      return false;
    }
    if (!user) {
      persistPendingPaper();
      setPhase("authGate");
      return false;
    }
    toast.message("正在批改全部大题…");
    let gradingSucceeded = true;
    for (const f of frqs) {
      if (!frqGrades[f.id]) {
        const succeeded = await gradeOneFrq(f);
        if (!succeeded) gradingSucceeded = false;
      }
    }
    if (!gradingSucceeded) {
      toast.error("部分作答尚未评分，请重试后再查看结果");
      return false;
    }
    const submittedCount = frqs.filter((f) => {
      const a = frqAnswers[f.id];
      return a && (a.text.trim() || a.fileUrl);
    }).length;
    for (let i = 0; i < submittedCount; i++) recordFrqSubmission();
    setFrqSubmitted(true);
    setPhase("done");
    clearPendingMock();
    return true;
  }

  async function revealResultsAfterAuth() {
    if (revealingRef.current || !user) return;
    revealingRef.current = true;
    setRevealError(false);
    const isFrqOnly = slug === "frq-pdf-practice" || slug.startsWith("frq-pack-");
    if (!isFrqOnly && questions.length > 0) {
      const access = await consumeMockAccess(slug, "reveal");
      if (!access.ok) {
        toast.error(access.message);
        setRevealError(true);
        revealingRef.current = false;
        return;
      }
    }
    if (questions.length > 0) persistMcqCloud(user.id);
    if (frqs.length === 0) {
      setFrqSubmitted(true);
      setPhase("done");
      clearPendingMock();
      revealingRef.current = false;
      return;
    }
    const ok = await submitAllFrqs();
    if (!ok && phase === "authGate") setRevealError(true);
    revealingRef.current = false;
  }

  useEffect(() => {
    if (phase !== "authGate" || !user) return;
    void revealResultsAfterAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, user?.id]);

  const stats = useMemo(() => {
    if (phase !== "done") return null;
    const total = questions.length;
    const correct = questions.filter((q) => answers[q.id] === q.correct_answer).length;
    return { total, correct };
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
          <Link
            to="/mock"
            activeOptions={{ exact: true }}
            activeProps={{ className: undefined, "aria-current": undefined }}
          >
            返回卷库
          </Link>
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
          activeOptions={{ exact: true }}
          activeProps={{ className: "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4", "aria-current": undefined }}
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
              无时间限制：自由作答 MCQ，再写完 3 道大题后一次性交卷。AI 一起批改后，才显示选择题对错与解析。
            </p>
          </button>
        </div>}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
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
            {!user && (
              <p className="text-xs text-muted-foreground text-center">
                未登录也可开始作答；查看成绩、解析和大题评分需要登录或注册。
              </p>
            )}
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

  if (phase === "authGate") {
    const continuePath = `/mock/${slug}`;
    return (
      <MockResultAuthGate
        continuePath={continuePath}
        signedIn={!!user}
        revealing={revealingRef.current}
        revealError={revealError}
        onRetry={() => void revealResultsAfterAuth()}
        onDiscard={() => {
          clearPendingMock();
          pendingRestoredRef.current = false;
          revealingRef.current = false;
          setRevealError(false);
          setPhase("idle");
        }}
      />
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
    const isFrqOnly = slug === "frq-pdf-practice" || slug.startsWith("frq-pack-");
    const gradedEarned = frqs.reduce((sum, f) => sum + (frqGrades[f.id]?.total_score ?? 0), 0);
    const gradedMax = frqs.reduce((sum, f) => sum + (frqGrades[f.id]?.max_score ?? 0), 0);
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <AlertDialog open={restartPrompt} onOpenChange={setRestartPrompt}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>要重新作答这个板块吗？</AlertDialogTitle>
              <AlertDialogDescription>
                {frqs.length === 1 ? "这道大题" : `这个板块的 ${frqs.length} 道大题`}已全部完成并评分
                {gradedMax > 0 ? `，当前得分 ${gradedEarned} / ${gradedMax} 分` : ""}。
                <br />
                选择「重新作答」会清空作答内容与显示的分数（旧记录会保留在历史里）；选择「继续复习」则保留你的答案和 AI 评分，用于复习。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={restarting}>继续复习</AlertDialogCancel>
              <AlertDialogAction
                disabled={restarting}
                onClick={(e) => {
                  e.preventDefault();
                  void restartAllFrqs();
                }}
              >
                {restarting ? "清空中…" : "重新作答（清空）"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {isFrqOnly && (
          <Link
            to="/frq"
            search={selectedFrqUnit ? { unit: selectedFrqUnit } : undefined}
            activeOptions={{ exact: true }}
            activeProps={{ className: "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground", "aria-current": undefined }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 返回题目列表
          </Link>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{questions.length === 0 ? "大题练习 · FRQ" : "Section II · FRQ"}</h1>
            <p className="text-xs text-muted-foreground">
              {isFrqOnly
                ? mode === "exam"
                  ? "仿真模式：到点自动交卷"
                  : "无时间限制，按得分点逐题评分"
                : `写完全部 ${frqs.length} 道大题后交卷，AI 会一起批改`}
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
              <HighlightColorBar hlColor={hlColor} setHlColor={setHlColor} className="text-muted-foreground [&_span]:text-[11px] [&_button]:h-5 [&_button]:w-5" />
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
          const saving = draftSaving[f.id];
          const savedAt = draftSavedAt[f.id];
          return (
            <Card key={f.id}>
              <CardContent className="p-5 space-y-4">
                <div className="font-semibold">
                  Question {i + 1}
                  {f.title ? ` · ${f.title}` : ""}
                  <span className="ml-2 text-xs text-muted-foreground">满分 {f.max_score} 分</span>
                  {user && !grade && (
                    <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                      {saving ? "保存中…" : savedAt ? "已自动保存" : ans.text || ans.fileUrl ? "已恢复草稿" : ""}
                    </span>
                  )}
                </div>
                <div
                  onMouseUp={(e) => onHighlightableMouseUp(e.currentTarget)}
                  onClick={onHighlightClick}
                  className={cn("select-text space-y-2", highlightActive && "cursor-text")}
                >
                  <FrqContent content={f.content} />
                </div>
                <FrqAnswerBox
                  paperId={paper.id}
                  frqId={f.id}
                  value={ans}
                  onChange={(v) => setFrqAnswers((s) => ({ ...s, [f.id]: v }))}
                  disabled={isFrqOnly && !!grade}
                />
                {isFrqOnly && !grade && (
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
                {isFrqOnly && grade && <FrqGradeCard grade={grade} />}
                {isFrqOnly && grade && (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void redoFrq(f)}
                    >
                      重新作答本题
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex flex-col items-end gap-2">
          <p className="text-xs text-muted-foreground">
            {frqs.every((f) => {
              const a = frqAnswers[f.id];
              return a && (a.text.trim() || a.fileUrl);
            })
              ? isFrqOnly
                ? "全部作答后即可查看评分"
                : "交卷后 AI 将一次性批改全部大题"
              : `请先完成全部 ${frqs.length} 道大题再交卷`}
          </p>
          <Button
            onClick={() => void submitAllFrqs()}
            disabled={
              allGrading ||
              !frqs.every((f) => {
                const a = frqAnswers[f.id];
                return a && (a.text.trim() || a.fileUrl);
              })
            }
          >
            {allGrading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isFrqOnly
              ? mode === "exam"
                ? "交卷并查看全部成绩"
                : "完成并查看全部评分"
              : "交卷，AI 一起批改"}
          </Button>
        </div>
        <HighlightRemoveMenu
          target={hlRemove}
          onClose={() => setHlRemove(null)}
          onRemove={() => {
            if (!hlRemove) return;
            unwrapHighlightSpan(hlRemove.span);
            setHlRemove(null);
          }}
        />
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
      <div
        className={cn(
          "fixed inset-0 z-50 flex flex-col overflow-x-hidden bg-white font-serif text-slate-900",
          highContrast && "invert",
        )}
        onMouseMove={lineReader ? (e) => setLineY(e.clientY) : undefined}
      >
        {lineReader && (
          <div
            aria-hidden
            className="pointer-events-none fixed inset-x-0 z-[56] h-9 -translate-y-1/2 bg-amber-300/30 ring-1 ring-amber-500/50"
            style={{ top: lineY }}
          />
        )}
        {/* Top bar */}
        <header className="shrink-0 border-b border-slate-300 bg-white">
          <div className="flex items-center gap-2 px-3 py-2 sm:h-14 sm:gap-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm sm:text-base">Section I</div>
              <button
                onClick={() => setShowDirections(true)}
                className="text-[11px] text-blue-700 hover:underline inline-flex items-center gap-1 sm:text-xs"
              >
                Directions <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <div className="flex shrink-0 flex-col items-center">
              <div className={cn("font-mono text-base tabular-nums sm:text-lg", lowTime && !hideTime && "text-red-600 font-bold")}>
                {hideTime ? "—:—" : `${mm}:${ss}`}
              </div>
              <button
                onClick={() => setHideTime((v) => !v)}
                className="text-[10px] px-2 py-0.5 rounded-full border border-slate-400 hover:bg-slate-100 sm:text-xs sm:px-3"
              >
                {hideTime ? "Show" : "Hide"}
              </button>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-[10px] sm:gap-5 sm:text-[11px]">
              <button
                onClick={() => setHighlightActive((v) => !v)}
                className={cn(
                  "flex flex-col items-center gap-0.5 transition-colors",
                  highlightActive ? "text-[#1a2b6b] font-bold" : "text-slate-700 hover:text-slate-900",
                )}
              >
                <Highlighter className="h-5 w-5" />
                <span className="hidden sm:inline">Highlights</span>
              </button>
              <button
                onClick={() => setShowCalc(true)}
                className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-slate-900"
              >
                <CalcIcon className="h-5 w-5" />
                <span className="hidden sm:inline">Calculator</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-slate-900">
                    <MoreVertical className="h-5 w-5" />
                    <span>More</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[80] w-48">
                  <DropdownMenuItem onClick={() => setShowDirections(true)}>Directions</DropdownMenuItem>
                  <DropdownMenuCheckboxItem checked={highContrast} onCheckedChange={(v) => setHighContrast(!!v)}>
                    High contrast
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={lineReader} onCheckedChange={(v) => setLineReader(!!v)}>
                    Line reader
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {highlightActive && (
            <HighlightColorBar hlColor={hlColor} setHlColor={setHlColor} className="justify-end border-t border-slate-200 px-3 py-1.5 sm:px-6" />
          )}
        </header>

        {/* Preview banner */}
        <div className="bg-[#1a2b6b] text-white text-center text-xs font-bold tracking-widest py-1.5">
          THIS IS A TEST PREVIEW
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
            {/* Question header bar */}
            <div className="flex items-center justify-between gap-2 border-b-2 border-dashed border-slate-300 pb-2 mb-5">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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
                  Mark<span className="hidden sm:inline"> for Review</span>
                </button>
              </div>
              <button
                onClick={() => setEliminateMode((v) => !v)}
                className={cn(
                  "shrink-0 text-xs font-bold px-2 py-1 rounded border-2",
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
              onClick={onHighlightClick}
              className={cn("text-[16px] leading-relaxed mb-6 select-text break-words sm:text-[17px]", highlightActive && "cursor-text")}
            >
              {renderStemWithTerms(cur.stem, cur.term_tags ?? [], termDict)}
            </div>
            {cur.image_url && (
              <img src={cur.image_url} alt="题图" className="mb-6 max-h-80 max-w-full h-auto rounded border border-slate-300" />
            )}

            {/* Options */}
            <div className="space-y-3">
              {opts.map((o) => {
                const picked = answers[cur.id] === o.k;
                const isCrossed = curCrossed.has(o.k);
                return (
                  <div key={o.k} className="flex items-stretch gap-2 sm:gap-3">
                    <button
                      onClick={() => {
                        if (isCrossed) return;
                        if (highlightActive && consumePendingHighlightClick()) return;
                        setAnswers({ ...answers, [cur.id]: o.k });
                      }}
                      disabled={isCrossed}
                      className={cn(
                        "relative min-w-0 flex-1 overflow-hidden text-left rounded-lg border px-3 py-2.5 flex items-start gap-3 transition-all bg-white sm:px-4 sm:py-3 sm:items-center",
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
                        )}
                      >
                        {o.k}
                      </span>
                      <span
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          onHighlightableMouseUp(e.currentTarget);
                        }}
                        onClick={onHighlightClick}
                        className={cn(
                          "min-w-0 flex-1 break-words text-[15px] leading-relaxed select-text",
                          highlightActive && "cursor-text",
                          isCrossed && "text-slate-500",
                        )}
                      >
                        {renderStemWithTerms(o.v, cur.term_tags ?? [], termDict)}
                      </span>
                      {isCrossed && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-3 right-3 top-1/2 z-[1] h-px -translate-y-1/2 bg-slate-800"
                        />
                      )}
                    </button>
                    {eliminateMode && (
                      <button
                        onClick={() => toggleCross(o.k)}
                        className={cn(
                          "shrink-0 self-center w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold hover:bg-slate-100",
                          isCrossed
                            ? "border-slate-900 text-slate-900 line-through"
                            : "border-slate-500 text-slate-700",
                        )}
                        title={isCrossed ? "Undo" : "Cross out"}
                        aria-label={isCrossed ? `撤销划掉选项 ${o.k}` : `划掉选项 ${o.k}`}
                      >
                        {o.k}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <footer className="relative shrink-0 border-t border-slate-300 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:h-16 sm:px-6 sm:py-0 sm:pb-0">
          <div className="flex h-full items-center gap-2">
            <div className="hidden min-w-0 flex-1 font-bold text-base sm:block">{userName}</div>
            <Button
              variant="outline"
              className="rounded-full bg-white px-3 sm:hidden"
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
            >
              Back
            </Button>
            <button
              onClick={() => setShowNav((v) => !v)}
              className="min-w-0 flex-1 truncate bg-slate-900 text-white rounded-full px-3 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1 hover:bg-slate-800 sm:flex-none sm:px-5 sm:text-sm sm:gap-2"
            >
              <span className="truncate">Question {idx + 1} of {questions.length}</span>
              {showNav ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronUp className="h-4 w-4 shrink-0" />}
            </button>
            <div className="flex shrink-0 justify-end gap-2 sm:flex-1">
              <Button
                variant="outline"
                className="hidden rounded-full bg-white sm:inline-flex"
                onClick={() => setIdx(Math.max(0, idx - 1))}
                disabled={idx === 0}
              >
                Back
              </Button>
              {idx < questions.length - 1 ? (
                <Button
                  onClick={() => setIdx(idx + 1)}
                  className="rounded-full bg-[#1a2b6b] hover:bg-[#0f1e54] text-white px-3 sm:px-4"
                >
                  Next
                </Button>
              ) : (
                <Button
                  onClick={() => setConfirmSubmit(true)}
                  className="rounded-full bg-[#1a2b6b] hover:bg-[#0f1e54] text-white px-3 sm:px-4"
                >
                  Submit
                </Button>
              )}
            </div>
          </div>

          {/* Question navigator popup */}
          {showNav && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNav(false)} />
              <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-50 w-[min(640px,calc(100vw-1.25rem))] max-h-[min(70vh,520px)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4 gap-2">
                  <div className="hidden flex-1 sm:block" />
                  <h3 className="text-base font-bold sm:text-xl">Section I Questions</h3>
                  <div className="flex flex-1 justify-end">
                    <button onClick={() => setShowNav(false)} className="text-slate-600 hover:text-slate-900">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="border-y border-slate-200 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs sm:gap-6 sm:text-sm mb-5">
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
                <div className="grid grid-cols-6 gap-1.5 mb-5 sm:grid-cols-10 sm:gap-2">
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
                            "w-full h-8 text-xs font-semibold flex items-center justify-center sm:h-9 sm:text-sm",
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
        <HighlightRemoveMenu
          target={hlRemove}
          onClose={() => setHlRemove(null)}
          onRemove={() => {
            if (!hlRemove) return;
            unwrapHighlightSpan(hlRemove.span);
            setHlRemove(null);
          }}
        />
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
          <h2 className="font-semibold mb-3">选择题 {stats.correct} / {stats.total}</h2>
          <McqResultGrid questions={questions} answers={answers} termDict={termDict} />
          <div className="mb-8" />

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
                        <FrqContent content={f.content} />
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
          <Link
            to={slug === "frq-pdf-practice" || slug.startsWith("frq-pack-") ? "/frq" : "/mock"}
            search={
              (slug === "frq-pdf-practice" || slug.startsWith("frq-pack-")) && selectedFrqUnit
                ? { unit: selectedFrqUnit }
                : undefined
            }
            activeOptions={{ exact: true }}
            activeProps={{ className: undefined, "aria-current": undefined }}
          >
            {slug === "frq-pdf-practice" || slug.startsWith("frq-pack-") ? "返回题目列表" : "返回卷库"}
          </Link>
        </Button>
      </div>
    </main>
  );
}
