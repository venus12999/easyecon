import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
    .select("sort_order,question_id,questions!inner(id,knowledge_point_id,correct_answer)")
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
  const pickMap = new Map(picks.map((p) => [p.question_id, p.picked]));
  const detail = ((pqs ?? []) as unknown as Array<{
    question_id: string;
    questions: { id: string; knowledge_point_id: string; correct_answer: string };
  }>).map((row) => {
    const picked = pickMap.get(row.question_id) ?? null;
    const correct = row.questions.correct_answer;
    return {
      question_id: row.question_id,
      knowledge_point_id: row.questions.knowledge_point_id,
      picked,
      correct,
      is_correct: picked === correct,
    };
  });
  return {
    total: detail.length,
    correct: detail.filter((d) => d.is_correct).length,
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
    frq_answers: row.frq_answers,
    mcq_total: submitted ? row.mcq_total : null,
    mcq_correct: submitted && published ? row.mcq_correct : null,
  };
}

type AttemptRow = NonNullable<Awaited<ReturnType<typeof loadAttempt>>>;

export async function finalizeIfOverdue(attempt: AttemptRow, paperId: string, endsAt: string) {
  if (attempt.submitted_at) return attempt;
  if (Date.now() <= Date.parse(endsAt)) return attempt;
  const raw = Array.isArray(attempt.mcq_detail) ? attempt.mcq_detail : [];
  const picks: McqPick[] = raw.map((row) => {
    const d = row as { question_id?: string; picked?: string | null };
    return { question_id: String(d.question_id ?? ""), picked: d.picked ?? null };
  }).filter((p) => p.question_id);
  const scored = await scorePaperMcq(paperId, picks);
  const { data } = await supabaseAdmin
    .from("school_attempts")
    .update({
      submitted_at: new Date().toISOString(),
      mcq_detail: scored.detail as Json,
      mcq_total: scored.total,
      mcq_correct: scored.correct,
    })
    .eq("id", attempt.id)
    .is("submitted_at", null)
    .select("id,assignment_id,roster_id,user_id,started_at,submitted_at,mcq_total,mcq_correct,duration_seconds,mcq_detail,frq_answers")
    .maybeSingle();
  return data ? { ...attempt, ...data } : attempt;
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
  const { data: frqs } = await supabaseAdmin
    .from("paper_frqs")
    .select("id,title,content,image_url,image_text,max_score,sort_order")
    .eq("paper_id", paperId)
    .order("sort_order", { ascending: true });
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
    if (published) return q;
    return {
      ...q,
      correct_answer: "",
      explanation: "",
    };
  });
  return { questions, frqs: frqs ?? [] };
}
