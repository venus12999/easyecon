import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { printedQuestionNumber } from "@/lib/ap-exam-parse";
import { readPageImage, readPointMarker, schoolExamAiOn, stripPageImage, stripPointMarker } from "@/lib/exam-flags";
import { gradeFrqAnswer, type FrqBreakdown } from "@/lib/frq-grade.server";
import { EXAM_LOCK_GRACE_MS, isUuid } from "@/lib/school-exam-session";
import type { Json } from "@/integrations/supabase/types";

export function examEmail(studentId: string, classId: string) {
  const id = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "stu";
  return `${id}.${classId.replace(/-/g, "").slice(0, 8)}@exam.easyecon.local`;
}

export function examAccountPassword(studentId: string, classId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_URL ?? "easyecon-exam";
  return createHmac("sha256", secret).update(`exam:${classId}:${studentId.trim().toLowerCase()}`).digest("base64url").slice(0, 32);
}

async function sessionFromPassword(email: string, password: string) {
  const anon = anonAuthClient();
  const session = (await anon.auth.signInWithPassword({ email, password })).data.session;
  if (!session) throw new Error("无法进入考场，请重试");
  return session;
}

async function sessionFromMagicLink(email: string) {
  const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data.properties?.hashed_token;
  if (!tokenHash) throw new Error(link.error?.message ?? "无法进入考场");
  const anon = anonAuthClient();
  const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (!verified.data.session) throw new Error(verified.error?.message ?? "无法进入考场，请重试");
  return verified.data.session;
}

export async function issueExamSession(email: string, password: string, existingUserId: string | null, metadata: Record<string, unknown>) {
  if (existingUserId) {
    const existing = await supabaseAdmin.auth.admin.getUserById(existingUserId);
    const existingEmail = existing.data.user?.email ?? email;
    const prevMeta = (existing.data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const user_metadata = { ...prevMeta, ...metadata };
    if (existingEmail.endsWith("@exam.easyecon.local")) {
      const upd = await supabaseAdmin.auth.admin.updateUserById(existingUserId, { password, user_metadata });
      if (upd.error) throw new Error(upd.error.message);
      return sessionFromPassword(existingEmail, password);
    }
    const metaUpd = await supabaseAdmin.auth.admin.updateUserById(existingUserId, { user_metadata });
    if (metaUpd.error) throw new Error(metaUpd.error.message);
    return sessionFromMagicLink(existingEmail);
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    throw new Error(created.error.message);
  }
  if (!created.data.user) {
    return sessionFromMagicLink(email);
  }
  return sessionFromPassword(email, password);
}

export function anonAuthClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase URL or anon key");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadAssignmentBundle(assignmentId: string) {
  if (!isUuid(assignmentId)) return null;
  const { data: assignment } = await supabaseAdmin
    .from("school_assignments")
    .select("id,class_id,paper_id,title,exam_code,starts_at,ends_at,results_published")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return null;
  const { data: paper } = await supabaseAdmin
    .from("mock_papers")
    .select("id,slug,title,total_seconds,frq_seconds,break_seconds,description")
    .eq("id", assignment.paper_id)
    .maybeSingle();
  if (!paper) return null;
  return { assignment, paper };
}

export async function rosterForUser(userId: string, classId: string) {
  const { data } = await supabaseAdmin
    .from("school_roster")
    .select("id,student_id,student_name,user_id,class_id")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function loadAttempt(assignmentId: string, rosterId: string) {
  const { data } = await supabaseAdmin
    .from("school_attempts")
    .select("id,assignment_id,roster_id,user_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers")
    .eq("assignment_id", assignmentId)
    .eq("roster_id", rosterId)
    .maybeSingle();
  return data;
}

export function inExamWindow(startsAt: string, endsAt: string, now = Date.now()) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return now >= start && now <= end;
}

export type McqPick = { question_id: string; picked: string | null };

export async function scorePaperMcq(paperId: string, picks: McqPick[]) {
  const { data: pqs } = await supabaseAdmin
    .from("paper_questions")
    .select("sort_order,question_id,questions!inner(id,knowledge_point_id,correct_answer,explanation)")
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
  const pickMap = new Map(picks.map((p) => [p.question_id, p.picked]));
  const detail = ((pqs ?? []) as unknown as Array<{
    question_id: string;
    questions: { id: string; knowledge_point_id: string; correct_answer: string; explanation: string | null };
  }>).map((row) => {
    const picked = pickMap.get(row.question_id) ?? null;
    const correct = (row.questions.correct_answer ?? "").trim().toUpperCase();
    const hasKey = ["A", "B", "C", "D", "E"].includes(correct);
    const points = readPointMarker(row.questions.explanation);
    return {
      question_id: row.question_id,
      knowledge_point_id: row.questions.knowledge_point_id,
      picked,
      correct: hasKey ? correct : "",
      is_correct: hasKey && picked === correct,
      points: hasKey ? points : 0,
    };
  });
  const keyed = detail.filter((d) => d.correct);
  return {
    total: keyed.reduce((sum, d) => sum + (d.points || 1), 0),
    correct: keyed.filter((d) => d.is_correct).reduce((sum, d) => sum + (d.points || 1), 0),
    detail,
  };
}

export function parseFrqAnswers(raw: unknown): {
  items: Record<string, { text: string; fileUrl: string | null; fileKind: string | null; fileName: string | null }>;
  progress: Record<string, unknown> | null;
} {
  if (!raw || typeof raw !== "object") return { items: {}, progress: null };
  const obj = raw as Record<string, unknown>;
  if (obj.items && typeof obj.items === "object") {
    return {
      items: obj.items as Record<string, { text: string; fileUrl: string | null; fileKind: string | null; fileName: string | null }>,
      progress: (obj.progress as Record<string, unknown> | null) ?? null,
    };
  }
  return { items: obj as Record<string, { text: string; fileUrl: string | null; fileKind: string | null; fileName: string | null }>, progress: null };
}

type SavedFrq = { text: string; fileUrl: string | null; fileKind: string | null; fileName: string | null };

function phaseRank(phase: unknown) {
  if (phase === "frq" || phase === "done") return 3;
  if (phase === "break") return 2;
  if (phase === "running") return 1;
  return 0;
}

function picksFrom(detail: unknown): McqPick[] {
  if (!Array.isArray(detail)) return [];
  return detail.map((row) => {
    const d = row as { question_id?: string; picked?: string | null };
    return { question_id: String(d.question_id ?? ""), picked: d.picked ?? null };
  }).filter((p) => p.question_id);
}

/** Keep the furthest section and never replace a saved answer with a blank. A submit still merges, even if an autosave took a newer sequence number. */
export function mergeSavedAttempt(
  existing: { mcq_detail: unknown; frq_answers: unknown },
  incoming: { mcq_detail?: McqPick[]; frq_answers?: unknown },
  opts?: { submit?: boolean },
) {
  const prev = parseFrqAnswers(existing.frq_answers);
  const next = parseFrqAnswers(incoming.frq_answers);
  const prevProgress = (prev.progress ?? {}) as Record<string, unknown>;
  const nextProgress = (next.progress ?? {}) as Record<string, unknown>;
  const prevSeq = Number(prevProgress.save_seq) || 0;
  const nextSeq = Number(nextProgress.save_seq) || 0;
  if (!opts?.submit && nextSeq > 0 && prevSeq > 0 && nextSeq < prevSeq) {
    return {
      mcq_detail: picksFrom(existing.mcq_detail),
      frq_answers: existing.frq_answers ?? { items: prev.items, progress: prevProgress },
    };
  }
  const alreadyLocked = prevProgress.mcq_locked === true || phaseRank(prevProgress.phase) >= 2;
  const prevPicks = picksFrom(existing.mcq_detail);
  const nextPicks = incoming.mcq_detail ?? [];
  const mcq = new Map<string, string | null>();
  if (alreadyLocked && prevPicks.length > 0) {
    prevPicks.forEach((p) => mcq.set(p.question_id, p.picked));
  } else {
    prevPicks.forEach((p) => mcq.set(p.question_id, p.picked));
    nextPicks.forEach((p) => {
      if (!p.question_id) return;
      const kept = mcq.get(p.question_id);
      if (p.picked || !kept) mcq.set(p.question_id, p.picked ?? null);
    });
  }
  const items: Record<string, SavedFrq> = {};
  const incomingHasItems = Object.keys(next.items).length > 0;
  if (!incomingHasItems) {
    Object.assign(items, prev.items);
  } else {
    for (const id of new Set([...Object.keys(prev.items), ...Object.keys(next.items)])) {
      const older = prev.items[id];
      const newer = next.items[id];
      if (newer && (newer.text?.trim() || newer.fileUrl || !older)) items[id] = newer;
      else if (older) items[id] = older;
      else if (newer) items[id] = newer;
    }
  }
  const phase = phaseRank(nextProgress.phase) >= phaseRank(prevProgress.phase)
    ? (typeof nextProgress.phase === "string" ? nextProgress.phase : prevProgress.phase)
    : prevProgress.phase;
  const mcqLocked = alreadyLocked || nextProgress.mcq_locked === true || phaseRank(phase) >= 2;
  return {
    mcq_detail: [...mcq.entries()].map(([question_id, picked]) => ({ question_id, picked })),
    frq_answers: {
      items,
      progress: {
        ...prevProgress,
        ...nextProgress,
        phase: mcqLocked && phaseRank(phase) < 2 ? "frq" : phase,
        mcq_locked: mcqLocked,
      },
    },
  };
}

export function redactMcqDetail(detail: unknown, published: boolean) {
  if (!Array.isArray(detail)) return [];
  return detail.map((row) => {
    if (!row || typeof row !== "object") return row;
    const d = row as Record<string, unknown>;
    const pick = { question_id: d.question_id, picked: d.picked ?? null };
    if (!published) return pick;
    return {
      ...pick,
      knowledge_point_id: d.knowledge_point_id,
      correct: d.correct,
      is_correct: d.is_correct,
    };
  });
}

function studentVisibleFrq(raw: unknown) {
  const parsed = parseFrqAnswers(raw);
  if (!parsed.progress) return { items: parsed.items };
  const progress = { ...parsed.progress };
  delete progress.grading_until;
  return { items: parsed.items, progress };
}

export type StoredFrqGrade = {
  max_score: number;
  ai_score: number | null;
  ai_comment: string | null;
  ai_suggestions: string | null;
  ai_breakdown?: FrqBreakdown[];
  manual_score: number | null;
  manual_comment: string | null;
  ai_failed?: boolean;
  ai_error?: string | null;
};

export function readStoredGrades(raw: unknown): Record<string, StoredFrqGrade> {
  if (!raw || typeof raw !== "object") return {};
  const grades = (raw as Record<string, unknown>).grades;
  if (!grades || typeof grades !== "object" || Array.isArray(grades)) return {};
  const out: Record<string, StoredFrqGrade> = {};
  for (const [id, value] of Object.entries(grades as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const g = value as Record<string, unknown>;
    const breakdown = Array.isArray(g.ai_breakdown)
      ? g.ai_breakdown.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const b = row as Record<string, unknown>;
          return [{ point: String(b.point ?? ""), awarded: !!b.awarded, comment: String(b.comment ?? "") }];
        })
      : undefined;
    out[id] = {
      max_score: typeof g.max_score === "number" ? g.max_score : 0,
      ai_score: typeof g.ai_score === "number" ? g.ai_score : null,
      ai_comment: typeof g.ai_comment === "string" ? g.ai_comment : null,
      ai_suggestions: typeof g.ai_suggestions === "string" ? g.ai_suggestions : null,
      ai_breakdown: breakdown,
      manual_score: typeof g.manual_score === "number" ? g.manual_score : null,
      manual_comment: typeof g.manual_comment === "string" ? g.manual_comment : null,
      ai_failed: g.ai_failed === true,
      ai_error: typeof g.ai_error === "string" ? g.ai_error : null,
    };
  }
  return out;
}

function explainGradeError(error: string, sort?: number | null) {
  const which = sort ? `Q${sort}` : "这一题";
  if (error === "ai_not_configured") return "AI 评分尚未配置，没能批改";
  if (error === "rate_limited") return `${which} 没批完：AI 评分请求过多。已经批完的题目已保存，稍后再试会继续`;
  if (error === "credits_exhausted") return `${which} 没批完：AI 评分额度不足。已经批完的题目已保存`;
  return `${which} 没批完。已经批完的题目已保存，可以稍后重试这名学生`;
}

function shownQuestionOrder(frq: { sort_order?: number | null; title?: string | null; content?: string | null; stem?: string | null }) {
  return printedQuestionNumber(`${frq.title ?? ""}\n${frq.stem ?? ""}\n${frq.content ?? ""}`) ?? frq.sort_order ?? null;
}

export function planSchoolGrade(
  frqs: { id: string; max_score: number | null; sort_order: number | null }[],
  items: Record<string, { text?: string | null; fileUrl?: string | null }>,
  grades: Record<string, StoredFrqGrade>,
  includeFailed = false,
) {
  const blanks: string[] = [];
  const pending: typeof frqs = [];
  for (const frq of frqs) {
    if (grades[frq.id]?.ai_score != null) continue;
    if (!includeFailed && grades[frq.id]?.ai_failed) continue;
    const text = items[frq.id]?.text?.trim() ?? "";
    const file = items[frq.id]?.fileUrl ?? "";
    if (!text && !file) blanks.push(frq.id);
    else pending.push(frq);
  }
  return { blanks, next: pending[0] ?? null, pending: pending.length };
}

export function readSubmittedAt(raw: unknown, column: string | null) {
  const progress = parseFrqAnswers(raw).progress;
  const stamped = progress && typeof progress.submitted_at === "string" ? progress.submitted_at : "";
  return stamped || column;
}

function withSubmitStamp(raw: unknown, at: string) {
  const parsed = parseFrqAnswers(raw);
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const progress = { ...(parsed.progress ?? {}) };
  if (typeof progress.submitted_at !== "string" || !progress.submitted_at) progress.submitted_at = at;
  return { ...base, items: parsed.items, progress };
}

function packFrqAnswers(raw: unknown, grades: Record<string, StoredFrqGrade>): Json {
  const parsed = parseFrqAnswers(raw);
  return {
    items: parsed.items,
    progress: parsed.progress,
    grades,
  } as unknown as Json;
}

function gradingLocked(progress: Record<string, unknown> | null) {
  const raw = progress?.grading_until;
  const until = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(until) && until > Date.now();
}

function writeGradeState(raw: unknown, grades: Record<string, StoredFrqGrade>, lockUntil: string | null): Json {
  const parsed = parseFrqAnswers(raw);
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const progress = { ...(parsed.progress ?? {}) };
  if (lockUntil) progress.grading_until = lockUntil;
  else delete progress.grading_until;
  return { ...base, items: parsed.items, progress, grades } as unknown as Json;
}

async function saveGradeState(attemptId: string, raw: unknown, grades: Record<string, StoredFrqGrade>, lockUntil: string | null) {
  const { error } = await supabaseAdmin.from("school_attempts").update({ frq_answers: writeGradeState(raw, grades, lockUntil) }).eq("id", attemptId);
  if (error) throw new Error(error.message);
}

export type SchoolGradeStep = {
  pending: number;
  done: boolean;
  busy: boolean;
  gradedSort: number | null;
  error: string | null;
  notice?: string | null;
};

/** Grade at most one answered FRQ, and keep every finished score before the next model call. */
export async function gradeNextSchoolFrq(attemptId: string, paperId: string, opts?: { force?: boolean; retryFailed?: boolean }): Promise<SchoolGradeStep> {
  const { data: attempt } = await supabaseAdmin
    .from("school_attempts")
    .select("id,frq_answers,submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt?.submitted_at) return { pending: 0, done: false, busy: false, gradedSort: null, error: "学生还没交卷" };
  const parsed = parseFrqAnswers(attempt.frq_answers);
  if (gradingLocked(parsed.progress)) {
    const grades = readStoredGrades(attempt.frq_answers);
    const { data: frqs } = await supabaseAdmin.from("paper_frqs").select("id,max_score,sort_order").eq("paper_id", paperId).order("sort_order");
    const plan = planSchoolGrade(frqs ?? [], parsed.items, grades);
    return { pending: plan.pending, done: false, busy: true, gradedSort: null, error: null };
  }
  if (!opts?.force) {
    const { data: paper } = await supabaseAdmin.from("mock_papers").select("description").eq("id", paperId).maybeSingle();
    if (!schoolExamAiOn(paper?.description)) return { pending: 0, done: true, busy: false, gradedSort: null, error: null };
  }
  const { data: frqs } = await supabaseAdmin
    .from("paper_frqs")
    .select("id,title,content,image_url,image_text,max_score,sort_order")
    .eq("paper_id", paperId)
    .order("sort_order");
  const list = frqs ?? [];
  let grades = readStoredGrades(attempt.frq_answers);
  const plan = planSchoolGrade(list, parsed.items, grades, !!opts?.retryFailed);
  for (const id of plan.blanks) {
    const frq = list.find((item) => item.id === id);
    const prev = grades[id];
    grades[id] = {
      max_score: prev?.max_score || frq?.max_score || 9,
      ai_score: 0,
      ai_comment: "未作答",
      ai_suggestions: null,
      manual_score: prev?.manual_score ?? null,
      manual_comment: prev?.manual_comment ?? null,
    };
  }
  if (!plan.next) {
    if (plan.blanks.length) await saveGradeState(attemptId, attempt.frq_answers, grades, null);
    return { pending: 0, done: true, busy: false, gradedSort: null, error: null };
  }
  const lockUntil = new Date(Date.now() + 40_000).toISOString();
  await saveGradeState(attemptId, attempt.frq_answers, grades, lockUntil);
  const frq = plan.next;
  const answer = parsed.items[frq.id];
  try {
    const ids = list.map((item) => item.id);
    const { data: rubrics } = ids.length
      ? await supabaseAdmin.from("paper_frq_rubrics").select("frq_id,rubric_note").in("frq_id", ids)
      : { data: [] as { frq_id: string; rubric_note: string | null }[] };
    const rubricMap = new Map((rubrics ?? []).map((row) => [row.frq_id, row.rubric_note]));
    const full = list.find((item) => item.id === frq.id);
    if (!full) {
      await saveGradeState(attemptId, attempt.frq_answers, grades, null);
      return { pending: plan.pending, done: false, busy: false, gradedSort: null, error: explainGradeError("ai_failed", shownQuestionOrder(frq)) };
    }
    const graded = await gradeFrqAnswer({
      frq: full,
      rubricNote: rubricMap.get(frq.id) ?? null,
      answerText: answer?.text?.trim() || null,
      answerFileUrl: answer?.fileUrl ?? null,
      answerFileKind: answer?.fileKind ?? null,
    });
    const { data: fresh } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
    const base = fresh?.frq_answers ?? attempt.frq_answers;
    grades = readStoredGrades(base);
    if (!graded.ok) {
      const prev = grades[frq.id];
      const reason = explainGradeError(graded.error, shownQuestionOrder(full));
      grades[frq.id] = {
        max_score: prev?.max_score || full.max_score || 9,
        ai_score: null,
        ai_comment: null,
        ai_suggestions: null,
        ai_failed: true,
        ai_error: reason,
        manual_score: prev?.manual_score ?? null,
        manual_comment: prev?.manual_comment ?? null,
      };
      await saveGradeState(attemptId, base, grades, null);
      return { pending: plan.pending, done: false, busy: false, gradedSort: null, error: reason };
    }
    const prev = grades[frq.id];
    grades[frq.id] = {
      max_score: graded.grade.max_score,
      ai_score: graded.grade.total_score,
      ai_comment: graded.grade.overall_comment,
      ai_suggestions: graded.grade.suggestions,
      ai_breakdown: graded.grade.breakdown,
      ai_failed: false,
      ai_error: null,
      manual_score: prev?.manual_score ?? null,
      manual_comment: prev?.manual_comment ?? null,
    };
    await saveGradeState(attemptId, base, grades, null);
    const left = plan.pending - 1;
    return { pending: left, done: left === 0, busy: false, gradedSort: frq.sort_order, error: null };
  } catch (error) {
    console.error("school frq grade", frq.id, error);
    const { data: fresh } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
    const base = fresh?.frq_answers ?? attempt.frq_answers;
    const saved = readStoredGrades(base);
    const prev = saved[frq.id];
    const reason = explainGradeError("ai_failed", shownQuestionOrder(frq));
    saved[frq.id] = {
      max_score: prev?.max_score || frq.max_score || 9,
      ai_score: null,
      ai_comment: null,
      ai_suggestions: null,
      ai_failed: true,
      ai_error: reason,
      manual_score: prev?.manual_score ?? null,
      manual_comment: prev?.manual_comment ?? null,
    };
    await saveGradeState(attemptId, base, saved, null).catch(() => undefined);
    return { pending: plan.pending, done: false, busy: false, gradedSort: null, error: reason };
  }
}

export function gradeBatchToken(assignmentId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_URL ?? "easyecon-exam";
  return createHmac("sha256", secret).update(`grade-batch:${assignmentId}`).digest("base64url");
}

export function continueGradeBatch(request: Request, assignmentId: string) {
  const url = new URL("/api/teacher/gradebook", request.url);
  const work = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-grade-token": gradeBatchToken(assignmentId) },
    body: JSON.stringify({ assignment_id: assignmentId, action: "batch" }),
  }).catch((error) => console.error("grade batch", error));
  const runtime = globalThis as { waitUntil?: (promise: Promise<unknown>) => void };
  if (typeof runtime.waitUntil === "function") runtime.waitUntil(work);
  else void work;
}

function fatalGradeError(error: string | null) {
  return !!error && /额度|尚未配置|请求过多/.test(error);
}

/** After the exam clock has stopped, grade one remaining answer and say whether to keep going. */
export async function gradeFinishedExamStep(assignmentId: string): Promise<SchoolGradeStep & { waiting: boolean }> {
  const idle = { pending: 0, done: true, busy: false, gradedSort: null as number | null, error: null as string | null, waiting: false };
  const { data: assignment } = await supabaseAdmin
    .from("school_assignments")
    .select("id,paper_id,ends_at")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return { ...idle, error: "考试不存在" };
  if (Date.now() < Date.parse(assignment.ends_at)) return { ...idle, done: false, waiting: true };
  const { data: paper } = await supabaseAdmin.from("mock_papers").select("description").eq("id", assignment.paper_id).maybeSingle();
  if (!schoolExamAiOn(paper?.description)) return idle;
  const { data: openAttempts } = await supabaseAdmin.from("school_attempts").select("id").eq("assignment_id", assignmentId).is("submitted_at", null);
  for (const row of openAttempts ?? []) await closeSchoolAttempt(row.id, assignment.paper_id);
  const [{ data: attempts }, { data: frqs }] = await Promise.all([
    supabaseAdmin.from("school_attempts").select("id,frq_answers,submitted_at").eq("assignment_id", assignmentId),
    supabaseAdmin.from("paper_frqs").select("id,max_score,sort_order").eq("paper_id", assignment.paper_id).order("sort_order"),
  ]);
  const submitted = (attempts ?? []).filter((row) => row.submitted_at);
  if (submitted.some((row) => gradingLocked(parseFrqAnswers(row.frq_answers).progress))) {
    return { ...idle, done: false, busy: true };
  }
  let pending = 0;
  let nextAttempt: string | null = null;
  for (const row of submitted) {
    const parsed = parseFrqAnswers(row.frq_answers);
    const plan = planSchoolGrade(frqs ?? [], parsed.items, readStoredGrades(row.frq_answers));
    pending += plan.pending;
    if (!nextAttempt && plan.next) nextAttempt = row.id;
  }
  if (!nextAttempt) return idle;
  const step = await gradeNextSchoolFrq(nextAttempt, assignment.paper_id);
  if (step.busy) return { ...idle, done: false, busy: true, pending };
  const consumed = step.gradedSort != null || !!step.error;
  const left = Math.max(0, pending - (consumed ? 1 : 0));
  if (fatalGradeError(step.error)) return { ...step, pending: left, done: false, waiting: false };
  return { ...step, error: null, notice: step.error, pending: left, done: left === 0, waiting: false };
}

export async function saveManualFrqScores(
  paperId: string,
  rawAnswers: unknown,
  manual: Record<string, number | null>,
  comments: Record<string, string | null> = {},
): Promise<Json> {
  const { data: frqs } = await supabaseAdmin.from("paper_frqs").select("id,max_score").eq("paper_id", paperId);
  const maxById = new Map((frqs ?? []).map((f) => [f.id, f.max_score ?? 9]));
  const grades = readStoredGrades(rawAnswers);
  for (const id of new Set([...Object.keys(manual), ...Object.keys(comments)])) {
    const max = maxById.get(id);
    if (max == null) continue;
    const prev = grades[id];
    const score = Object.prototype.hasOwnProperty.call(manual, id) ? manual[id] : prev?.manual_score ?? null;
    const note = Object.prototype.hasOwnProperty.call(comments, id) ? (comments[id] ?? "").trim() : prev?.manual_comment ?? null;
    grades[id] = {
      max_score: prev?.max_score || max,
      ai_score: prev?.ai_score ?? null,
      ai_comment: prev?.ai_comment ?? null,
      ai_suggestions: prev?.ai_suggestions ?? null,
      ai_breakdown: prev?.ai_breakdown,
      ai_failed: prev?.ai_failed === true && prev?.ai_score == null,
      ai_error: prev?.ai_error ?? null,
      manual_score: score == null ? null : Math.max(0, Math.min(max, Math.round(score))),
      manual_comment: note || null,
    };
  }
  return packFrqAnswers(rawAnswers, grades);
}

export type TeacherFrqView = {
  frq_id: string;
  title: string | null;
  sort_order: number;
  max_score: number;
  answer_text: string;
  file_url: string | null;
  ai_score: number | null;
  ai_failed?: boolean;
  ai_error?: string | null;
  ai_comment: string | null;
  ai_suggestions: string | null;
  breakdown: FrqBreakdown[];
  manual_score: number | null;
  manual_comment: string | null;
};

export function teacherFrqViews(
  rawAnswers: unknown,
  frqs: { id: string; title: string | null; sort_order: number; max_score: number }[],
  submissions: { frq_id: string; ai_score: number | null; ai_max_score: number | null; ai_overall: string | null; ai_suggestions: string | null; ai_breakdown: unknown }[],
): TeacherFrqView[] {
  const parsed = parseFrqAnswers(rawAnswers);
  const grades = readStoredGrades(rawAnswers);
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const row of submissions) if (!latest.has(row.frq_id)) latest.set(row.frq_id, row);
  return [...frqs]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((frq) => {
      const stored = grades[frq.id];
      const prior = latest.get(frq.id);
      const answer = parsed.items[frq.id];
      const breakdown = stored?.ai_breakdown?.length
        ? stored.ai_breakdown
        : Array.isArray(prior?.ai_breakdown)
          ? prior.ai_breakdown.flatMap((row) => {
              if (!row || typeof row !== "object") return [];
              const b = row as Record<string, unknown>;
              return [{ point: String(b.point ?? ""), awarded: !!b.awarded, comment: String(b.comment ?? "") }];
            })
          : [];
      return {
        frq_id: frq.id,
        title: frq.title,
        sort_order: frq.sort_order,
        max_score: stored?.max_score || prior?.ai_max_score || frq.max_score || 9,
        answer_text: answer?.text ?? "",
        file_url: answer?.fileUrl ?? null,
        ai_score: stored?.ai_score ?? prior?.ai_score ?? null,
        ai_failed: stored?.ai_failed === true && stored?.ai_score == null,
        ai_error: stored?.ai_failed && stored?.ai_score == null ? stored?.ai_error ?? null : null,
        ai_comment: stored?.ai_comment ?? prior?.ai_overall ?? null,
        ai_suggestions: stored?.ai_suggestions ?? prior?.ai_suggestions ?? null,
        breakdown,
        manual_score: stored?.manual_score ?? null,
        manual_comment: stored?.manual_comment ?? null,
      };
    });
}

export function publicAttempt(
  row: {
    started_at: string;
    submitted_at: string | null;
    mcq_total: number | null;
    mcq_correct: number | null;
    duration_seconds: number | null;
    mcq_detail: unknown;
    frq_answers: unknown;
  },
  published: boolean,
) {
  const submitted = !!row.submitted_at;
  return {
    started_at: row.started_at,
    submitted,
    submitted_at: row.submitted_at,
    duration_seconds: row.duration_seconds,
    mcq_detail: redactMcqDetail(row.mcq_detail, published),
    frq_answers: studentVisibleFrq(row.frq_answers),
    mcq_total: submitted ? row.mcq_total : null,
    mcq_correct: submitted && published ? row.mcq_correct : null,
  };
}

const ATTEMPT_FIELDS = "id,assignment_id,roster_id,user_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers";

type AttemptRow = NonNullable<Awaited<ReturnType<typeof loadAttempt>>>;

export async function closeSchoolAttempt(
  attemptId: string,
  paperId: string,
  patch?: { mcq_detail?: unknown; frq_answers?: unknown; duration_seconds?: number | null },
) {
  const { data: current } = await supabaseAdmin.from("school_attempts").select(ATTEMPT_FIELDS).eq("id", attemptId).maybeSingle();
  if (!current || current.submitted_at) return current;
  const scored = await scorePaperMcq(paperId, picksFrom(patch?.mcq_detail ?? current.mcq_detail));
  const submittedAt = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("school_attempts")
    .update({
      submitted_at: submittedAt,
      mcq_detail: scored.detail as Json,
      frq_answers: withSubmitStamp(patch?.frq_answers ?? current.frq_answers, submittedAt) as Json,
      duration_seconds: patch?.duration_seconds ?? current.duration_seconds,
      mcq_total: scored.total,
      mcq_correct: scored.correct,
    })
    .eq("id", attemptId)
    .is("submitted_at", null)
    .select(ATTEMPT_FIELDS)
    .maybeSingle();
  if (!data) return current;
  return data;
}

export async function finalizeIfOverdue(attempt: AttemptRow, paperId: string, endsAt: string) {
  if (attempt.submitted_at) return attempt;
  if (Date.now() <= Date.parse(endsAt)) return attempt;
  const closed = await closeSchoolAttempt(attempt.id, paperId);
  return closed ? { ...attempt, ...closed } : attempt;
}

export type TeacherMcqView = { n: number; picked: string | null; is_correct: boolean | null };

export function teacherMcqViews(
  questions: { question_id: string; sort_order: number; correct_answer: string | null }[],
  detail: unknown,
): TeacherMcqView[] {
  const stored = new Map<string, string | null>();
  if (Array.isArray(detail)) {
    for (const row of detail) {
      if (!row || typeof row !== "object") continue;
      const item = row as { question_id?: string; picked?: string | null };
      if (!item.question_id) continue;
      stored.set(item.question_id, item.picked ?? null);
    }
  }
  return [...questions]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((question) => {
      const raw = stored.get(question.question_id);
      const picked = raw ? raw.trim().toUpperCase() : null;
      const correct = (question.correct_answer ?? "").trim().toUpperCase();
      const known = ["A", "B", "C", "D", "E"].includes(correct);
      return {
        n: question.sort_order,
        picked,
        is_correct: picked && known ? picked === correct : null,
      };
    });
}

export async function alignFrqNumbers<T extends { sort_order: number; title?: string | null; content?: string | null; stem?: string | null }>(paperId: string, frqs: T[]): Promise<T[]> {
  const ordered = [...frqs].sort((a, b) => a.sort_order - b.sort_order);
  const fromText = ordered.map((frq) => printedQuestionNumber(`${frq.title ?? ""}\n${frq.stem ?? ""}\n${frq.content ?? ""}`));
  if (fromText.every((n) => n != null) && new Set(fromText).size === fromText.length) {
    return ordered.map((frq, index) => ({ ...frq, sort_order: fromText[index]! }));
  }
  const { data: imported } = await supabaseAdmin
    .from("school_pdf_imports")
    .select("id")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!imported) return ordered;
  const { data: items } = await supabaseAdmin
    .from("school_pdf_items")
    .select("sort_order,stem,content")
    .eq("import_id", imported.id)
    .eq("kind", "frq")
    .order("sort_order");
  if (!items || items.length !== ordered.length) return ordered;
  const numbers = items.map((item) => printedQuestionNumber(`${item.stem ?? ""}\n${item.content ?? ""}`) ?? item.sort_order);
  if (new Set(numbers).size !== numbers.length) return ordered;
  return ordered.map((frq, index) => ({ ...frq, sort_order: numbers[index] }));
}

export type ActiveExamPayload = {
  assignmentId: string;
  paperSlug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  submitted: boolean;
  resultsPublished: boolean;
  studentName: string;
  studentId: string;
  locked: boolean;
};

export async function loadActiveExamForUser(userId: string): Promise<ActiveExamPayload | null> {
  const { data: rosterRows } = await supabaseAdmin
    .from("school_roster")
    .select("id,class_id,student_id,student_name")
    .eq("user_id", userId);
  if (!rosterRows?.length) return null;
  const classIds = [...new Set(rosterRows.map((r) => r.class_id))];
  const { data: assignments } = await supabaseAdmin
    .from("school_assignments")
    .select("id,class_id,paper_id,title,starts_at,ends_at,results_published")
    .in("class_id", classIds)
    .order("starts_at", { ascending: false });
  if (!assignments?.length) return null;
  const rosterByClass = new Map(rosterRows.map((r) => [r.class_id, r]));
  const paperIds = [...new Set(assignments.map((a) => a.paper_id))];
  const { data: papers } = await supabaseAdmin.from("mock_papers").select("id,slug").in("id", paperIds);
  const paperMap = new Map((papers ?? []).map((p) => [p.id, p]));
  const now = Date.now();
  const candidates: ActiveExamPayload[] = [];
  for (const a of assignments) {
    const roster = rosterByClass.get(a.class_id);
    if (!roster) continue;
    let attempt = await loadAttempt(a.id, roster.id);
    if (attempt) attempt = await finalizeIfOverdue(attempt, a.paper_id, a.ends_at);
    const submitted = !!attempt?.submitted_at;
    const graceEnd = Date.parse(a.ends_at) + EXAM_LOCK_GRACE_MS;
    const inGrace = now <= graceEnd;
    const startedOrOpen = !!attempt || now >= Date.parse(a.starts_at);
    const lockedUnsubmitted = !submitted && startedOrOpen && inGrace;
    const lockedWaiting = submitted && !a.results_published && inGrace;
    if (!lockedUnsubmitted && !lockedWaiting) continue;
    const paper = paperMap.get(a.paper_id);
    if (!paper) continue;
    candidates.push({
      assignmentId: a.id,
      paperSlug: paper.slug,
      title: a.title,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      submitted,
      resultsPublished: a.results_published,
      studentName: roster.student_name,
      studentId: roster.student_id,
      locked: lockedUnsubmitted || lockedWaiting,
    });
  }
  candidates.sort((x, y) => Number(y.locked) - Number(x.locked) || Date.parse(y.startsAt) - Date.parse(x.startsAt));
  return candidates[0] ?? null;
}

export async function loadSchoolPaperQuestions(paperId: string, published: boolean) {
  const { data: pqs } = await supabaseAdmin
    .from("paper_questions")
    .select(
      "sort_order,questions!inner(id,knowledge_point_id,stem,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,image_url,term_tags,knowledge_points!inner(name_zh,unit))",
    )
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
  const { data: frqRows } = await supabaseAdmin
    .from("paper_frqs")
    .select("id,title,content,image_url,image_text,max_score,sort_order")
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
  const frqs = await alignFrqNumbers(paperId, frqRows ?? []);
  type QRow = {
    id: string;
    knowledge_point_id: string;
    stem: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    option_e: string | null;
    correct_answer: string;
    explanation: string | null;
    image_url: string | null;
    term_tags: string[] | null;
    knowledge_points: { name_zh: string; unit: number } | null;
  };
  const questions = ((pqs ?? []) as unknown as Array<{ questions: QRow }>).map((row) => {
    const q = row.questions;
    const points = readPointMarker(q.explanation);
    const page_image_url = readPageImage(q.explanation);
    const explanation = stripPageImage(stripPointMarker(q.explanation));
    if (published) return { ...q, explanation, points, page_image_url };
    return {
      ...q,
      correct_answer: "",
      explanation: "",
      points,
      page_image_url,
    };
  });
  return { questions, frqs: frqs ?? [] };
}
