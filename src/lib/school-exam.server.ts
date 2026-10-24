import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { officialFrqMax, printedQuestionNumber, repairPrintedSpacing, splitTrailingChoiceE } from "@/lib/ap-exam-parse";
import { readPageImage, readPointMarker, schoolExamAiOn, stripPageImage, stripPointMarker } from "@/lib/exam-flags";
import { presentExamFrqs } from "@/lib/ap-2022-paper";
import { fixAp2025Frqs, fixAp2025Questions } from "@/lib/ap-2025-paper";
import { beijingTime } from "@/lib/beijing-time";
import { isBlankStudentAnswer } from "@/lib/frq-answer";
import { answerNeedsReview, gradeFrqAnswer, pointsFromRubric, type FrqBreakdown } from "@/lib/frq-grade.server";
import { gradingConcurrency, gradingHost, gradingMaxRetries, gradingSlotsAvailable, gradingTimeoutMs, retryWaitMs, withGradingSlot } from "@/lib/grading-config.server";
import { groupFrqParts, resolvePartOverride, scalePointsToMax } from "@/lib/frq-parts";
import { splitImageTextRubric, splitTeacherFrq } from "@/lib/frq-teacher-fields";
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
    .select("id,class_id,paper_id,title,exam_code,starts_at,ends_at,results_published,mcq_seconds,frq_seconds,break_seconds,score_max")
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
  manual_parts?: Record<string, number> | null;
  ai_failed?: boolean;
  ai_error?: string | null;
  ai_tries?: number;
  retry_after?: string | null;
  needs_review?: boolean;
};

function gradeAttemptCount(grade?: StoredFrqGrade) {
  if (!grade) return 0;
  if (typeof grade.ai_tries === "number") return grade.ai_tries;
  return grade.ai_failed ? 1 : 0;
}

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
          const points = typeof b.points === "number" ? b.points : undefined;
          const earned = typeof b.earned === "number" ? b.earned : undefined;
          return [{
            point: String(b.point ?? ""),
            awarded: earned != null ? earned > 0 : !!b.awarded,
            comment: String(b.comment ?? ""),
            ...(points != null && earned != null ? { points, earned } : {}),
          }];
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
      manual_parts: readManualParts(g.manual_parts),
      ai_failed: g.ai_failed === true,
      ai_error: typeof g.ai_error === "string" ? g.ai_error : null,
      ai_tries: typeof g.ai_tries === "number" ? g.ai_tries : undefined,
      retry_after: typeof g.retry_after === "string" ? g.retry_after : null,
      needs_review: g.needs_review === true,
    };
  }
  return out;
}

function readManualParts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, score] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-e]$/.test(key) || typeof score !== "number" || !Number.isInteger(score) || score < 0) continue;
    out[key] = score;
  }
  return Object.keys(out).length ? out : null;
}

function formatRetryWhen(at: Date) {
  const clock = beijingTime(at).slice(11, 16);
  const seconds = Math.max(1, Math.round((at.getTime() - Date.now()) / 1000));
  const wait = seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
  return `北京时间 ${clock}（约 ${wait}后）`;
}

function finalGradeReason(error: string, sort?: number | null, student?: string | null) {
  if (error === "ai_not_configured" || error === "ai_unauthorized" || error === "missing_max_score" || error === "credits_exhausted") {
    return explainGradeError(error, sort, student, null);
  }
  const which = sort ? `Q${sort}` : "这一题";
  const who = student ? `${student} 的 ` : "";
  return `${who}${which} 批改失败。已经出分的会保留。可以单独重试这名学生或这道题。`;
}

function explainGradeError(error: string, sort?: number | null, student?: string | null, when?: string | null) {
  const which = sort ? `Q${sort}` : "这一题";
  const who = student ? `${student} 的 ` : "";
  const later = when ? `下次可重试时间 ${when}。` : "稍后再试会继续。";
  if (error === "ai_not_configured") return student ? `${student}：AI 评分尚未配置，没能批改` : "AI 评分尚未配置，没能批改";
  if (error === "ai_unauthorized") return student ? `${student}：AI 评分密钥无效，没能批改` : "AI 评分密钥无效，没能批改";
  if (error === "missing_max_score") return `${who}${which} 没有满分，请老师先填写再批改`;
  if (error === "rate_limited") return `${who}${which} 没批完：AI 评分请求过多。已经出分的会保留。${later}`;
  if (error === "timeout") return `${who}${which} 没批完：评分超时。已经出分的会保留。${later}`;
  if (error === "bad_json") return `${who}${which} 没批完：评分结果无法读取。已经出分的会保留。${later}`;
  if (error === "network") return `${who}${which} 没批完：连接评分服务失败。已经出分的会保留。${later}`;
  if (error === "upstream") return `${who}${which} 没批完：评分服务暂时没有返回结果。已经出分的会保留。${later}`;
  if (error === "credits_exhausted") return `${who}${which} 没批完：AI 评分额度不足。已经出分的会保留`;
  return `${who}${which} 没批完：评分没有完成。已经出分的会保留。${later}`;
}

async function rosterGradeLabel(rosterId: string | null | undefined) {
  if (!rosterId) return null;
  const { data } = await supabaseAdmin.from("school_roster").select("student_name,student_id").eq("id", rosterId).maybeSingle();
  if (!data) return null;
  const name = data.student_name?.trim() ?? "";
  const id = data.student_id?.trim() ?? "";
  if (name && id && name !== id) return `${name}（${id}）`;
  return name || id || null;
}

function scaleStoredScore(score: number | null, fromMax: number, toMax: number) {
  if (score == null) return null;
  if (fromMax < 1 || toMax < 1 || fromMax === toMax) return score;
  return Math.max(0, Math.min(toMax, Math.round((score / fromMax) * toMax)));
}

function positiveScore(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && value >= 1) return value;
  }
  return 0;
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
  const fresh: typeof frqs = [];
  const retry: typeof frqs = [];
  let cooling = 0;
  for (const frq of frqs) {
    const grade = grades[frq.id];
    if (grade?.ai_score != null || grade?.manual_score != null) continue;
    const tries = gradeAttemptCount(grade);
    const givenUp = grade?.ai_failed === true && tries >= gradingMaxRetries();
    if (givenUp && !includeFailed) continue;
    const text = items[frq.id]?.text ?? "";
    const file = items[frq.id]?.fileUrl ?? "";
    if (isBlankStudentAnswer(text, file)) {
      blanks.push(frq.id);
      continue;
    }
    const retryAt = grade?.retry_after ? Date.parse(grade.retry_after) : NaN;
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      cooling += 1;
      continue;
    }
    if (tries > 0 || grade?.ai_failed) retry.push(frq);
    else fresh.push(frq);
  }
  const queue = includeFailed ? [...retry, ...fresh] : [...fresh, ...retry];
  return { blanks, next: queue[0] ?? null, pending: queue.length + cooling, cooling };
}

export function readSubmittedAt(raw: unknown, column: string | null) {
  const progress = parseFrqAnswers(raw).progress;
  const stamped = progress && typeof progress.submitted_at === "string" ? progress.submitted_at : "";
  return stamped || column;
}

function withSubmitStamp(raw: unknown, at: string, collected?: "deadline") {
  const parsed = parseFrqAnswers(raw);
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const progress = { ...(parsed.progress ?? {}) };
  if (typeof progress.submitted_at !== "string" || !progress.submitted_at) progress.submitted_at = at;
  if (collected === "deadline") progress.collected_reason = "deadline";
  return { ...base, items: parsed.items, progress };
}

export function readCollectedReason(raw: unknown) {
  const progress = parseFrqAnswers(raw).progress;
  return progress?.collected_reason === "deadline" ? "deadline" as const : null;
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

async function saveGradeState(attemptId: string, raw: unknown, grades: Record<string, StoredFrqGrade>, lockUntil: string | null, leaseToken?: string | null) {
  const { data: current } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
  const live = parseFrqAnswers(current?.frq_answers);
  const pauseUntil = gradingPauseUntil(current?.frq_answers);
  const liveLease = typeof live.progress?.grading_lease === "string" ? live.progress.grading_lease : "";
  const lease = leaseToken === undefined ? liveLease : (leaseToken ?? "");
  const state = writeGradeState(raw, grades, lockUntil);
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const progress = { ...((state as { progress?: Record<string, unknown> }).progress ?? {}) };
    if (pauseUntil > Date.now()) progress.grading_pause_until = new Date(pauseUntil).toISOString();
    else delete progress.grading_pause_until;
    if (lease) progress.grading_lease = lease;
    else delete progress.grading_lease;
    (state as { progress: Record<string, unknown> }).progress = progress;
  }
  const { error } = await supabaseAdmin.from("school_attempts").update({ frq_answers: state }).eq("id", attemptId);
  if (error) throw new Error(error.message);
}

export type SchoolGradeStep = {
  pending: number;
  done: boolean;
  busy: boolean;
  gradedSort: number | null;
  error: string | null;
  notice?: string | null;
  retryAt?: string | null;
  released?: boolean;
};

const GRADE_PAUSE_MS = 45_000;

function markGradeRetry(prev: StoredFrqGrade | undefined, maxScore: number | null, error: string, reason: string, retryAtIso?: string | null) {
  const tries = gradeAttemptCount(prev) + 1;
  const maxTries = gradingMaxRetries();
  const hardStop = error === "credits_exhausted" || error === "ai_not_configured" || error === "ai_unauthorized" || error === "missing_max_score";
  const giveUp = hardStop || tries >= maxTries;
  const keepScore = prev?.ai_score != null;
  return {
    giveUp,
    grade: {
      max_score: positiveScore(prev?.max_score, maxScore),
      ai_score: keepScore ? prev?.ai_score ?? null : null,
      ai_comment: keepScore ? prev?.ai_comment ?? null : null,
      ai_suggestions: keepScore ? prev?.ai_suggestions ?? null : null,
      ai_breakdown: keepScore ? prev?.ai_breakdown : undefined,
      ai_failed: giveUp && !keepScore,
      ai_error: keepScore ? null : reason,
      ai_tries: hardStop ? maxTries : tries,
      retry_after: giveUp || keepScore ? null : (retryAtIso ?? new Date(Date.now() + retryWaitMs(gradeAttemptCount(prev), null)).toISOString()),
      manual_score: prev?.manual_score ?? null,
      manual_comment: prev?.manual_comment ?? null,
      manual_parts: prev?.manual_parts ?? null,
      needs_review: prev?.needs_review === true,
    } satisfies StoredFrqGrade,
  };
}

function blankStoredGrade(prev: StoredFrqGrade | undefined, maxScore: number | null): StoredFrqGrade {
  return {
    max_score: positiveScore(prev?.max_score, maxScore),
    ai_score: 0,
    ai_comment: "未作答",
    ai_suggestions: null,
    manual_score: prev?.manual_score ?? null,
    manual_comment: prev?.manual_comment ?? null,
    manual_parts: prev?.manual_parts ?? null,
  };
}

function applyBlankGrades(frqs: { id: string; max_score: number | null }[], raw: unknown) {
  const parsed = parseFrqAnswers(raw);
  const grades = readStoredGrades(raw);
  let changed = false;
  for (const frq of frqs) {
    const prev = grades[frq.id];
    if (prev?.ai_score != null || prev?.manual_score != null) continue;
    const item = parsed.items[frq.id];
    if (!isBlankStudentAnswer(item?.text, item?.fileUrl)) continue;
    grades[frq.id] = blankStoredGrade(prev, frq.max_score);
    changed = true;
  }
  return changed ? grades : null;
}

/** Write 0 / 未作答 for empty FRQs so an auto-collected blank paper can produce an AP score without a model call. */
export async function persistBlankFrqZeros(assignmentId: string, paperId: string) {
  const [{ data: attempts }, { data: frqs }] = await Promise.all([
    supabaseAdmin.from("school_attempts").select("id,submitted_at").eq("assignment_id", assignmentId),
    supabaseAdmin.from("paper_frqs").select("id,max_score").eq("paper_id", paperId),
  ]);
  const list = frqs ?? [];
  if (!list.length) return;
  for (const row of attempts ?? []) {
    if (!row.submitted_at) continue;
    const { data: fresh } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", row.id).maybeSingle();
    if (!fresh || gradingLocked(parseFrqAnswers(fresh.frq_answers).progress)) continue;
    const grades = applyBlankGrades(list, fresh.frq_answers);
    if (!grades) continue;
    const { data: again } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", row.id).maybeSingle();
    if (!again || JSON.stringify(again.frq_answers) !== JSON.stringify(fresh.frq_answers)) continue;
    if (gradingLocked(parseFrqAnswers(again.frq_answers).progress)) continue;
    await saveGradeState(row.id, again.frq_answers, grades, null);
  }
}

function gradingPauseUntil(raw: unknown) {
  const value = parseFrqAnswers(raw).progress?.grading_pause_until;
  const until = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(until) ? until : 0;
}

function gradingPauseNotice(until: number) {
  const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  if (seconds > 10 * 60) return "已停止自动批改。已经批完的分数还在。";
  return `AI 评分请求过多，大约 ${seconds} 秒后自动再试。已经批完的分数还在。`;
}

async function writeClassGradingPause(assignmentId: string, until: string | null, force = false) {
  const { data: attempts } = await supabaseAdmin.from("school_attempts").select("id,frq_answers,submitted_at").eq("assignment_id", assignmentId);
  const nextUntil = until ? Date.parse(until) : 0;
  for (const row of attempts ?? []) {
    if (!row.submitted_at) continue;
    const existing = gradingPauseUntil(row.frq_answers);
    if (until && existing > Date.now() + 10 * 60_000) continue;
    if (!force && until && existing >= nextUntil - 1000) continue;
    if (!until && existing <= Date.now()) continue;
    const parsed = parseFrqAnswers(row.frq_answers);
    const grades = readStoredGrades(row.frq_answers);
    const base = row.frq_answers && typeof row.frq_answers === "object" && !Array.isArray(row.frq_answers) ? { ...(row.frq_answers as Record<string, unknown>) } : {};
    const progress = { ...(parsed.progress ?? {}) };
    if (until) progress.grading_pause_until = until;
    else delete progress.grading_pause_until;
    await supabaseAdmin.from("school_attempts").update({ frq_answers: { ...base, items: parsed.items, progress, grades } as Json }).eq("id", row.id);
  }
}

let gradeNotBefore = 0;

function holdGrading(untilMs: number) {
  if (untilMs > gradeNotBefore) gradeNotBefore = untilMs;
}

function coolingStatus(grades: Record<string, StoredFrqGrade>) {
  let best: { at: number; message: string } | null = null;
  for (const grade of Object.values(grades)) {
    const at = grade.retry_after ? Date.parse(grade.retry_after) : NaN;
    if (!Number.isFinite(at) || at <= Date.now()) continue;
    if (!best || at < best.at) best = { at, message: grade.ai_error || gradingPauseNotice(at) };
  }
  return best;
}

/** One in-flight request per student answer. A second retry while it is running does not call the model. */
async function claimAnswerGrade(attemptId: string, raw: unknown, grades: Record<string, StoredFrqGrade>) {
  const token = crypto.randomUUID();
  const lockUntil = new Date(Date.now() + gradingTimeoutMs() + 20_000).toISOString();
  await saveGradeState(attemptId, raw, grades, lockUntil, token);
  const { data: check } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
  return parseFrqAnswers(check?.frq_answers).progress?.grading_lease === token ? token : null;
}

async function pauseClassGrading(assignmentId: string, until = new Date(Date.now() + GRADE_PAUSE_MS).toISOString()) {
  holdGrading(Date.parse(until));
  await writeClassGradingPause(assignmentId, until, true);
}

export async function stopClassGrading(assignmentId: string) {
  await writeClassGradingPause(assignmentId, new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString());
}

export async function resumeClassGrading(assignmentId: string) {
  gradeNotBefore = 0;
  await writeClassGradingPause(assignmentId, null);
}

const gradingAttempts = new Set<string>();

/** Grade at most one answered FRQ, and keep every finished score before the next model call. */
export async function gradeNextSchoolFrq(attemptId: string, paperId: string, opts?: { force?: boolean; retryFailed?: boolean }): Promise<SchoolGradeStep> {
  if (gradingAttempts.has(attemptId)) {
    return { pending: 1, done: false, busy: true, gradedSort: null, error: null, notice: "这道题正在批，请等这次结束。" };
  }
  gradingAttempts.add(attemptId);
  try {
    return await gradeNextSchoolFrqInner(attemptId, paperId, opts);
  } finally {
    gradingAttempts.delete(attemptId);
  }
}

async function gradeNextSchoolFrqInner(attemptId: string, paperId: string, opts?: { force?: boolean; retryFailed?: boolean }): Promise<SchoolGradeStep> {
  const { data: attempt } = await supabaseAdmin
    .from("school_attempts")
    .select("id,assignment_id,frq_answers,submitted_at,roster_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt?.submitted_at) return { pending: 0, done: false, busy: false, gradedSort: null, error: "学生还没交卷" };
  if (gradeNotBefore > Date.now()) {
    return { pending: 1, done: false, busy: true, gradedSort: null, error: null, notice: gradingPauseNotice(gradeNotBefore), retryAt: new Date(gradeNotBefore).toISOString() };
  }
  const paused = gradingPauseUntil(attempt.frq_answers);
  if (paused > Date.now()) return { pending: 1, done: false, busy: true, gradedSort: null, error: null, notice: gradingPauseNotice(paused), retryAt: new Date(paused).toISOString() };
  const parsed = parseFrqAnswers(attempt.frq_answers);
  if (gradingLocked(parsed.progress)) {
    const grades = readStoredGrades(attempt.frq_answers);
    const { data: frqs } = await supabaseAdmin.from("paper_frqs").select("id,max_score,sort_order").eq("paper_id", paperId).order("sort_order");
    const plan = planSchoolGrade(frqs ?? [], parsed.items, grades);
    return { pending: plan.pending, done: false, busy: true, gradedSort: null, error: null, notice: "这道题正在批，请等这次结束。" };
  }
  const { data: paper } = await supabaseAdmin.from("mock_papers").select("slug,description").eq("id", paperId).maybeSingle();
  if (!opts?.force && !schoolExamAiOn(paper?.description)) return { pending: 0, done: true, busy: false, gradedSort: null, error: null };
  const { data: frqs } = await supabaseAdmin
    .from("paper_frqs")
    .select("id,title,content,image_url,image_text,max_score,sort_order")
    .eq("paper_id", paperId)
    .order("sort_order");
  const list = presentExamFrqs(frqs ?? [], paper?.slug);
  let grades = readStoredGrades(attempt.frq_answers);
  const plan = planSchoolGrade(list, parsed.items, grades, !!opts?.retryFailed);
  for (const id of plan.blanks) {
    const frq = list.find((item) => item.id === id);
    grades[id] = blankStoredGrade(grades[id], frq?.max_score ?? null);
  }
  if (!plan.next) {
    if (plan.blanks.length) await saveGradeState(attemptId, attempt.frq_answers, grades, null);
    const cooling = coolingStatus(grades);
    return {
      pending: plan.pending,
      done: !cooling,
      busy: !!cooling,
      gradedSort: null,
      error: null,
      notice: cooling?.message ?? null,
      retryAt: cooling ? new Date(cooling.at).toISOString() : null,
    };
  }
  const frq = plan.next;
  const answer = parsed.items[frq.id];
  const studentLabel = await rosterGradeLabel(attempt.roster_id);
  try {
    const ids = list.map((item) => item.id);
    const { data: rubrics } = ids.length
      ? await supabaseAdmin.from("paper_frq_rubrics").select("frq_id,rubric_note").in("frq_id", ids)
      : { data: [] as { frq_id: string; rubric_note: string | null }[] };
    const rubricMap = new Map((rubrics ?? []).map((row) => [row.frq_id, row.rubric_note]));
    const full = list.find((item) => item.id === frq.id);
    if (!full) {
      await saveGradeState(attemptId, attempt.frq_answers, grades, null, null);
      return { pending: plan.pending, done: false, busy: false, gradedSort: null, error: explainGradeError("ai_failed", shownQuestionOrder(frq), studentLabel) };
    }
    const lease = await claimAnswerGrade(attemptId, attempt.frq_answers, grades);
    if (!lease) {
      return { pending: plan.pending, done: false, busy: true, gradedSort: null, error: null, notice: "这道题正在批，请等这次结束。" };
    }
    const graded = await withGradingSlot(() => gradeFrqAnswer({
      frq: full,
      rubricNote: rubricMap.get(frq.id) ?? null,
      answerText: answer?.text?.trim() || null,
      answerFileUrl: answer?.fileUrl ?? null,
      answerFileKind: answer?.fileKind ?? null,
    }));
    const { data: fresh } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
    const base = fresh?.frq_answers ?? attempt.frq_answers;
    grades = readStoredGrades(base);
    if (!graded.ok) {
      const prev = grades[frq.id];
      const sort = shownQuestionOrder(full);
      const hardStop = graded.error === "credits_exhausted" || graded.error === "ai_not_configured" || graded.error === "ai_unauthorized" || graded.error === "missing_max_score";
      const waitMs = hardStop ? 0 : retryWaitMs(gradeAttemptCount(prev), graded.retryAfterMs ?? null);
      const retryAt = waitMs > 0 ? new Date(Date.now() + waitMs) : null;
      const marked = markGradeRetry(prev, full.max_score, graded.error, "", retryAt?.toISOString() ?? null);
      const reason = marked.giveUp
        ? finalGradeReason(graded.error, sort, studentLabel)
        : explainGradeError(graded.error, sort, studentLabel, retryAt ? formatRetryWhen(retryAt) : null);
      grades[frq.id] = markGradeRetry(prev, full.max_score, graded.error, reason, retryAt?.toISOString() ?? null).grade;
      await saveGradeState(attemptId, base, grades, null, null);
      if (graded.error === "rate_limited" && attempt.assignment_id && retryAt && !marked.giveUp) await pauseClassGrading(attempt.assignment_id, retryAt.toISOString());
      const coolingOff = !!retryAt && !marked.giveUp;
      return { pending: plan.pending, done: false, busy: coolingOff, gradedSort: null, error: reason, notice: reason, retryAt: coolingOff ? retryAt?.toISOString() ?? null : null, released: marked.giveUp };
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
      ai_tries: 0,
      retry_after: null,
      needs_review: graded.grade.needs_review === true || answerNeedsReview(answer?.text),
      manual_score: prev?.manual_score ?? null,
      manual_comment: prev?.manual_comment ?? null,
      manual_parts: prev?.manual_parts ?? null,
    };
    await saveGradeState(attemptId, base, grades, null, null);
    const left = plan.pending - 1;
    return { pending: left, done: left === 0, busy: false, gradedSort: frq.sort_order, error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.name : "failed";
    console.info(JSON.stringify({ event: "frq_grade", host: gradingHost(), ok: false, error: detail }));
    const { data: fresh } = await supabaseAdmin.from("school_attempts").select("frq_answers").eq("id", attemptId).maybeSingle();
    const base = fresh?.frq_answers ?? attempt.frq_answers;
    const saved = readStoredGrades(base);
    const prev = saved[frq.id];
    const sort = shownQuestionOrder(frq);
    const marked = markGradeRetry(prev, frq.max_score, "ai_failed", "");
    const reason = marked.giveUp ? finalGradeReason("ai_failed", sort, studentLabel) : explainGradeError("ai_failed", sort, studentLabel, null);
    saved[frq.id] = markGradeRetry(prev, frq.max_score, "ai_failed", reason).grade;
    await saveGradeState(attemptId, base, saved, null, null).catch(() => undefined);
    return { pending: plan.pending, done: false, busy: false, gradedSort: null, error: reason, notice: reason, released: marked.giveUp };
  }
}

export function gradeBatchToken(assignmentId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_URL ?? "easyecon-exam";
  return createHmac("sha256", secret).update(`grade-batch:${assignmentId}`).digest("base64url");
}

export function continueGradeBatch(request: Request, assignmentId: string) {
  const url = new URL("/api/teacher/gradebook", request.url);
  const runtime = globalThis as { waitUntil?: (promise: Promise<unknown>) => void };
  const work = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-grade-token": gradeBatchToken(assignmentId) },
          body: JSON.stringify({ assignment_id: assignmentId, action: "batch" }),
        });
        await response.body?.cancel();
        if (response.ok || response.status === 401 || response.status === 404) return;
      } catch (error) {
        console.error("grade batch", error);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  })();
  if (typeof runtime.waitUntil === "function") runtime.waitUntil(work);
  else void work;
}

/** Wake the queue when a short backoff ends, including after the page request itself has returned. */
export function scheduleGradeRetry(request: Request, assignmentId: string, retryAt: string | null | undefined) {
  const at = retryAt ? Date.parse(retryAt) : NaN;
  const wait = at - Date.now();
  if (!Number.isFinite(wait) || wait < 500 || wait > 130_000) return;
  const url = new URL("/api/teacher/gradebook", request.url);
  const runtime = globalThis as { waitUntil?: (promise: Promise<unknown>) => void };
  const work = (async () => {
    await new Promise((resolve) => setTimeout(resolve, wait + 250));
    if (gradeNotBefore > Date.now() + 1000) return;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-grade-token": gradeBatchToken(assignmentId) },
        body: JSON.stringify({ assignment_id: assignmentId, action: "batch" }),
      });
      await response.body?.cancel();
    } catch (error) {
      console.error("grade retry", error);
    }
  })();
  if (typeof runtime.waitUntil === "function") runtime.waitUntil(work);
  else void work;
}

export function fatalGradeError(error: string | null) {
  return !!error && /尚未配置/.test(error);
}

/** After the exam clock has stopped, grade one wave of remaining answers. */
async function gradeFinishedExamWave(assignmentId: string, limit: number): Promise<SchoolGradeStep & { waiting: boolean }> {
  const idle = { pending: 0, done: true, busy: false, gradedSort: null as number | null, error: null as string | null, waiting: false };
  const { data: assignment } = await supabaseAdmin
    .from("school_assignments")
    .select("id,paper_id,ends_at")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return { ...idle, error: "考试不存在" };
  if (Date.now() < Date.parse(assignment.ends_at)) return { ...idle, done: false, waiting: true };
  await collectFinishedExam(assignmentId, { endsAt: assignment.ends_at, paperId: assignment.paper_id });
  await persistBlankFrqZeros(assignmentId, assignment.paper_id);
  const { data: paper } = await supabaseAdmin.from("mock_papers").select("description").eq("id", assignment.paper_id).maybeSingle();
  if (!schoolExamAiOn(paper?.description)) return idle;
  const [{ data: attempts }, { data: frqs }] = await Promise.all([
    supabaseAdmin.from("school_attempts").select("id,frq_answers,submitted_at").eq("assignment_id", assignmentId),
    supabaseAdmin.from("paper_frqs").select("id,max_score,sort_order").eq("paper_id", assignment.paper_id).order("sort_order"),
  ]);
  const submitted = (attempts ?? []).filter((row) => row.submitted_at);
  const pauseAt = submitted.reduce((max, row) => Math.max(max, gradingPauseUntil(row.frq_answers)), 0);
  let pending = 0;
  let cooling = 0;
  let anyLocked = false;
  const ready: string[] = [];
  for (const row of submitted) {
    const parsed = parseFrqAnswers(row.frq_answers);
    const locked = gradingLocked(parsed.progress);
    const plan = planSchoolGrade(frqs ?? [], parsed.items, readStoredGrades(row.frq_answers));
    pending += plan.pending;
    cooling += plan.cooling;
    if (locked && plan.next) anyLocked = true;
    if (!locked && plan.next) ready.push(row.id);
  }
  if (gradeNotBefore > Date.now() && (pending > 0 || cooling > 0)) {
    return { ...idle, done: false, busy: true, pending, notice: gradingPauseNotice(gradeNotBefore), retryAt: new Date(gradeNotBefore).toISOString(), waiting: false };
  }
  if (pauseAt > Date.now() && (pending > 0 || cooling > 0)) {
    return { ...idle, done: false, busy: true, pending, notice: gradingPauseNotice(pauseAt), retryAt: new Date(pauseAt).toISOString(), waiting: false };
  }
  const slots = Math.min(Math.max(1, limit), gradingSlotsAvailable());
  const wave = slots > 0 ? ready.slice(0, slots) : [];
  if (!wave.length) {
    if (anyLocked || cooling > 0 || ready.length > 0) return { ...idle, done: false, busy: true, pending, waiting: false };
    return { ...idle, pending: 0, done: true };
  }
  const steps = await Promise.all(wave.map((id) => gradeNextSchoolFrq(id, assignment.paper_id)));
  const fatal = steps.find((step) => fatalGradeError(step.error));
  const consumed = steps.filter((step) => step.gradedSort != null || step.released === true).length;
  const left = Math.max(0, pending - consumed);
  if (fatal?.error) return { ...fatal, pending: left, done: false, waiting: false };
  const notices = steps.flatMap((step) => [step.error, step.notice]).filter((message): message is string => !!message);
  const notice = notices.length === 0 ? null : notices.length <= 4 ? notices.join("；") : `${notices.slice(0, 4).join("；")}；另有 ${notices.length - 4} 名学生没批完`;
  const blocked = anyLocked || cooling > 0 || steps.some((step) => step.busy);
  const retryAt = steps.map((step) => step.retryAt).filter((value): value is string => !!value).sort()[0] ?? null;
  return {
    pending: left,
    done: left === 0,
    busy: blocked && left > 0,
    retryAt,
    gradedSort: steps.find((step) => step.gradedSort != null)?.gradedSort ?? null,
    error: null,
    notice,
    waiting: false,
  };
}

/** Grade up to GRADING_CONCURRENCY answers at once. One request is enough; the batch caller chains the next wave. */
export async function drainSchoolGrades(assignmentId: string, budgetMs = 80_000) {
  if (budgetMs <= 0) return { pending: 0, done: false, busy: true, gradedSort: null, error: null, waiting: false };
  return gradeFinishedExamWave(assignmentId, gradingConcurrency());
}

/** After the exam clock has stopped, grade one remaining answer and say whether to keep going. */
export async function gradeFinishedExamStep(assignmentId: string): Promise<SchoolGradeStep & { waiting: boolean }> {
  return gradeFinishedExamWave(assignmentId, 1);
}

export async function saveManualFrqScores(
  paperId: string,
  rawAnswers: unknown,
  manual: Record<string, number | null>,
  comments: Record<string, string | null> = {},
  partScores: Record<string, Record<string, number | null>> = {},
): Promise<Json> {
  const { data: frqs } = await supabaseAdmin.from("paper_frqs").select("id,max_score,content,image_text,sort_order").eq("paper_id", paperId);
  const list = frqs ?? [];
  const ids = list.map((frq) => frq.id);
  const { data: rubrics } = ids.length
    ? await supabaseAdmin.from("paper_frq_rubrics").select("frq_id,rubric_note").in("frq_id", ids)
    : { data: [] as { frq_id: string; rubric_note: string | null }[] };
  const rubricById = new Map((rubrics ?? []).map((row) => [row.frq_id, row.rubric_note]));
  const byId = new Map(list.map((frq) => [frq.id, frq]));
  const grades = readStoredGrades(rawAnswers);
  for (const id of new Set([...Object.keys(manual), ...Object.keys(comments), ...Object.keys(partScores)])) {
    const frq = byId.get(id);
    if (!frq) continue;
    const max = positiveScore(frq.max_score);
    const prev = grades[id];
    const rubric = rubricById.get(id)?.trim() || splitImageTextRubric(frq.image_text).rubric || splitTeacherFrq(frq.content).rubric_note;
    const parts = groupFrqParts({
      breakdown: prev?.ai_breakdown,
      content: splitTeacherFrq(frq.content).content,
      rubric,
      maxScore: max,
    });
    const override = resolvePartOverride(parts, partScores[id], max, frq.sort_order ?? 0);
    if (override.error) throw new Error(override.error);
    const score = override.used
      ? override.manual_score
      : Object.prototype.hasOwnProperty.call(manual, id) ? manual[id] : prev?.manual_score ?? null;
    const note = Object.prototype.hasOwnProperty.call(comments, id) ? (comments[id] ?? "").trim() : prev?.manual_comment ?? null;
    grades[id] = {
      max_score: prev?.max_score || max,
      ai_score: prev?.ai_score ?? null,
      ai_comment: prev?.ai_comment ?? null,
      ai_suggestions: prev?.ai_suggestions ?? null,
      ai_breakdown: prev?.ai_breakdown,
      ai_failed: prev?.ai_failed === true && prev?.ai_score == null,
      ai_error: prev?.ai_error ?? null,
      ai_tries: prev?.ai_tries,
      retry_after: prev?.retry_after ?? null,
      needs_review: prev?.needs_review === true,
      manual_score: score == null ? null : Math.max(0, Math.min(max, Math.round(score))),
      manual_comment: note || null,
      manual_parts: override.used ? override.manual_parts : score == null ? null : prev?.manual_parts ?? null,
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
  ai_tries?: number;
  needs_review?: boolean;
  ai_comment: string | null;
  ai_suggestions: string | null;
  breakdown: FrqBreakdown[];
  parts: { key: string; label: string; max: number; max_known: boolean; ai_earned: number | null; manual_earned: number | null; points: FrqBreakdown[] }[];
  manual_score: number | null;
  manual_comment: string | null;
};

export function teacherFrqViews(
  rawAnswers: unknown,
  frqs: { id: string; title: string | null; sort_order: number; max_score: number; content?: string | null; image_text?: string | null; rubric_note?: string | null }[],
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
      let breakdown = stored?.ai_breakdown?.length
        ? stored.ai_breakdown
        : Array.isArray(prior?.ai_breakdown)
          ? prior.ai_breakdown.flatMap((row) => {
              if (!row || typeof row !== "object") return [];
              const b = row as Record<string, unknown>;
              const points = typeof b.points === "number" ? b.points : undefined;
              const earned = typeof b.earned === "number" ? b.earned : undefined;
              return [{
                point: String(b.point ?? ""),
                awarded: earned != null ? earned > 0 : !!b.awarded,
                comment: String(b.comment ?? ""),
                ...(points != null && earned != null ? { points, earned } : {}),
              }];
            })
          : [];
      const paperMax = officialFrqMax(`${frq.title ?? ""}\n${frq.content ?? ""}`, frq.max_score);
      const recordedMax = positiveScore(stored?.max_score, prior?.ai_max_score);
      const maxScore = paperMax || recordedMax;
      if (breakdown.length) breakdown = scalePointsToMax(breakdown, maxScore);
      const needsReview = stored?.needs_review === true || answerNeedsReview(answer?.text) || /建议复核|需老师复核/.test(stored?.ai_comment ?? prior?.ai_overall ?? "");
      if (needsReview && breakdown.length === 0) {
        const rubric = frq.rubric_note?.trim() || splitImageTextRubric(frq.image_text).rubric || splitTeacherFrq(frq.content).rubric_note;
        breakdown = pointsFromRubric(rubric);
      }
      const parts = groupFrqParts({
        breakdown,
        content: splitTeacherFrq(frq.content).content,
        rubric: frq.rubric_note,
        maxScore,
      }).map((part) => ({
        key: part.key,
        label: part.label,
        max: part.max,
        max_known: part.max_known,
        ai_earned: part.ai_earned,
        manual_earned: stored?.manual_parts?.[part.key] ?? null,
        points: part.points,
      }));
      return {
        frq_id: frq.id,
        title: frq.title,
        sort_order: frq.sort_order,
        max_score: maxScore,
        answer_text: answer?.text ?? "",
        file_url: answer?.fileUrl ?? null,
        ai_score: scaleStoredScore(stored?.ai_score ?? prior?.ai_score ?? null, recordedMax, maxScore),
        ai_failed: stored?.ai_failed === true && stored?.ai_score == null,
        ai_error: stored?.ai_score == null ? stored?.ai_error ?? null : null,
        ai_tries: stored?.ai_score == null ? gradeAttemptCount(stored) : 0,
        needs_review: needsReview,
        ai_comment: stored?.ai_comment ?? prior?.ai_overall ?? null,
        ai_suggestions: stored?.ai_suggestions ?? prior?.ai_suggestions ?? null,
        breakdown,
        parts,
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
  opts?: { collected?: "deadline" },
) {
  const { data: current } = await supabaseAdmin.from("school_attempts").select(ATTEMPT_FIELDS).eq("id", attemptId).maybeSingle();
  if (!current || current.submitted_at) return current;
  const sourceDetail = patch?.mcq_detail ?? current.mcq_detail;
  let mcqDetail: Json = (sourceDetail ?? []) as Json;
  let mcqTotal = current.mcq_total;
  let mcqCorrect = current.mcq_correct;
  try {
    const scored = await scorePaperMcq(paperId, picksFrom(sourceDetail));
    mcqDetail = scored.detail as Json;
    mcqTotal = scored.total;
    mcqCorrect = scored.correct;
  } catch (error) {
    console.error("score mcq on collect", attemptId, error);
  }
  const submittedAt = new Date().toISOString();
  const stamped = withSubmitStamp(patch?.frq_answers ?? current.frq_answers, submittedAt, opts?.collected);
  const { data: paperFrqs } = await supabaseAdmin.from("paper_frqs").select("id,max_score").eq("paper_id", paperId);
  const blankGrades = applyBlankGrades(paperFrqs ?? [], stamped);
  const frqAnswers = blankGrades ? packFrqAnswers(stamped, blankGrades) : stamped;
  const { data, error } = await supabaseAdmin
    .from("school_attempts")
    .update({
      submitted_at: submittedAt,
      mcq_detail: mcqDetail,
      frq_answers: frqAnswers as Json,
      duration_seconds: patch?.duration_seconds ?? current.duration_seconds,
      mcq_total: mcqTotal,
      mcq_correct: mcqCorrect,
    })
    .eq("id", attemptId)
    .is("submitted_at", null)
    .select(ATTEMPT_FIELDS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: again } = await supabaseAdmin.from("school_attempts").select(ATTEMPT_FIELDS).eq("id", attemptId).maybeSingle();
    return again ?? current;
  }
  return data;
}

/** Drop a leftover grading lock and let unfinished answers be graded again. */
export async function releaseGradeLocks(assignmentId: string, opts?: { force?: boolean }) {
  const { data: attempts } = await supabaseAdmin.from("school_attempts").select("id,frq_answers").eq("assignment_id", assignmentId);
  for (const row of attempts ?? []) {
    const parsed = parseFrqAnswers(row.frq_answers);
    const untilRaw = parsed.progress?.grading_until;
    const until = typeof untilRaw === "string" ? Date.parse(untilRaw) : NaN;
    const lockLive = !opts?.force && Number.isFinite(until) && until > Date.now();
    const grades = readStoredGrades(row.frq_answers);
    let changed = typeof untilRaw === "string" && !lockLive;
    for (const [id, grade] of Object.entries(grades)) {
      if (lockLive) continue;
      if (grade.ai_score == null && grade.manual_score == null && (grade.ai_failed || grade.retry_after || (grade.ai_tries ?? 0) > 0)) {
        grades[id] = { ...grade, ai_failed: false, ai_tries: 0, retry_after: null, ai_error: null };
        changed = true;
      }
    }
    if (!changed) continue;
    await saveGradeState(row.id, row.frq_answers, grades, lockLive && typeof untilRaw === "string" ? untilRaw : null, lockLive ? undefined : null);
  }
}

let sweeping = false;
let sweeperStarted = false;

async function sweepDueExams() {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = new Date().toISOString();
    const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("school_assignments")
      .select("id,paper_id,ends_at")
      .lte("ends_at", now)
      .gte("ends_at", since)
      .eq("results_published", false)
      .limit(20);
    for (const exam of data ?? []) {
      await collectFinishedExam(exam.id, { endsAt: exam.ends_at, paperId: exam.paper_id });
      await drainSchoolGrades(exam.id, 25000);
    }
  } catch (error) {
    console.error("sweep due exams", error);
  } finally {
    sweeping = false;
  }
}

function ensureExamSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const timer = setInterval(() => { void sweepDueExams(); }, 15000);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") timer.unref();
}

/** Once the clock has stopped, close every started paper. Students who never opened the exam stay missing and show as 未参加. */
export async function collectFinishedExam(assignmentId: string, known?: { endsAt?: string; paperId?: string }) {
  ensureExamSweeper();
  let endsAt = known?.endsAt;
  let paperId = known?.paperId;
  if (!endsAt || !paperId) {
    const { data } = await supabaseAdmin.from("school_assignments").select("paper_id,ends_at").eq("id", assignmentId).maybeSingle();
    if (!data) return { due: false, closed: 0 };
    endsAt = data.ends_at;
    paperId = data.paper_id;
  }
  if (Date.now() < Date.parse(endsAt)) return { due: false, closed: 0 };
  const { data: openAttempts } = await supabaseAdmin
    .from("school_attempts")
    .select("id")
    .eq("assignment_id", assignmentId)
    .is("submitted_at", null);
  let closed = 0;
  for (const row of openAttempts ?? []) {
    try {
      const saved = await closeSchoolAttempt(row.id, paperId, undefined, { collected: "deadline" });
      if (saved?.submitted_at) closed += 1;
    } catch (error) {
      console.error("collect attempt", row.id, error);
    }
  }
  return { due: true, closed };
}

export async function finalizeIfOverdue(attempt: AttemptRow, paperId: string, endsAt: string) {
  if (attempt.submitted_at) return attempt;
  if (Date.now() < Date.parse(endsAt)) return attempt;
  const closed = await closeSchoolAttempt(attempt.id, paperId, undefined, { collected: "deadline" });
  return closed ? { ...attempt, ...closed } : attempt;
}

export type TeacherMcqView = { n: number; picked: string | null; is_correct: boolean | null };

export function mcqSectionClosed(raw: unknown) {
  const parsed = parseFrqAnswers(raw);
  const progress = parsed.progress as Record<string, unknown> | null;
  if (progress && (progress.mcq_locked === true || phaseRank(progress.phase) >= 2)) return true;
  return Object.values(parsed.items).some((item) => !!item?.text?.trim() || !!item?.fileUrl);
}

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

export async function loadActiveExamForUser(userId: string, request?: Request): Promise<ActiveExamPayload | null> {
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
    if (now >= Date.parse(a.ends_at)) {
      await collectFinishedExam(a.id, { endsAt: a.ends_at, paperId: a.paper_id });
      if (request) continueGradeBatch(request, a.id);
    }
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

export async function loadSchoolPaperQuestions(paperId: string, published: boolean, slug?: string | null) {
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
  const questions = ((pqs ?? []) as unknown as Array<{ sort_order: number; questions: QRow }>).map((row) => {
    const q = row.questions;
    const choices = splitTrailingChoiceE(q.option_d ?? "", q.option_e ?? "");
    q.option_d = choices.option_d;
    q.option_e = choices.option_e || null;
    const points = readPointMarker(q.explanation);
    const page_image_url = readPageImage(q.explanation);
    const explanation = stripPageImage(stripPointMarker(q.explanation));
    if (published) return { ...q, explanation, points, page_image_url, sort_order: row.sort_order };
    return {
      ...q,
      correct_answer: "",
      explanation: "",
      points,
      page_image_url,
      sort_order: row.sort_order,
    };
  });
  const cleanedQuestions = (slug === "ap-micro-2025" ? fixAp2025Questions(questions) : questions).map((question) => ({
    ...question,
    stem: repairPrintedSpacing(question.stem),
    option_a: repairPrintedSpacing(question.option_a),
    option_b: repairPrintedSpacing(question.option_b),
    option_c: repairPrintedSpacing(question.option_c),
    option_d: repairPrintedSpacing(question.option_d),
    option_e: question.option_e ? repairPrintedSpacing(question.option_e) : question.option_e,
  }));
  const baseFrqs = slug === "ap-micro-2025" ? fixAp2025Frqs(frqs ?? []) : (frqs ?? []);
  const numberedFrqs = presentExamFrqs(baseFrqs, slug);
  const cleanedFrqs = numberedFrqs.map((frq) => ({
    ...frq,
    max_score: officialFrqMax(`${frq.title ?? ""}\n${frq.content ?? ""}`, frq.max_score),
  }));
  return { questions: cleanedQuestions, frqs: cleanedFrqs };
}
