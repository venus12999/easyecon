import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isUuid } from "@/lib/school-exam-session";

export function examEmail(studentId: string, classId: string, optionalEmail?: string) {
  const extra = (optionalEmail ?? "").trim().toLowerCase();
  if (extra && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra) && !extra.endsWith("@exam.easyecon.local")) {
    return extra;
  }
  const id = studentId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "stu";
  return `${id}.${classId.replace(/-/g, "").slice(0, 8)}@exam.easyecon.local`;
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
    .select("id,slug,title,total_seconds,frq_seconds,break_seconds")
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
