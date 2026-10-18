const KEY = "easyecon:school-exam";
const EXITED_PREFIX = "easyecon:school-exam-exited:";

export const EXAM_LOCK_GRACE_MS = 2 * 60 * 60 * 1000;

export type SchoolExamSession = {
  assignmentId: string;
  paperSlug: string;
  title: string;
  endsAt: string;
  submitted: boolean;
  resultsPublished: boolean;
  studentName?: string;
  studentId?: string;
};

export function loadSchoolExamSession(): SchoolExamSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchoolExamSession;
    if (!parsed?.assignmentId || !parsed.paperSlug) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SESSION_EVENT = "easyecon:school-exam-changed";

function notifySchoolExamSession() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function subscribeSchoolExamSession(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SESSION_EVENT, onChange);
  return () => window.removeEventListener(SESSION_EVENT, onChange);
}

export function saveSchoolExamSession(session: SchoolExamSession) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(session);
  sessionStorage.setItem(KEY, raw);
  localStorage.removeItem(KEY);
  notifySchoolExamSession();
}

export function clearSchoolExamSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
  notifySchoolExamSession();
}

export function isSchoolExamLocked(session: SchoolExamSession | null, now = Date.now()) {
  if (!session) return false;
  if (hasExitedExam(session.assignmentId)) return false;
  if (session.submitted && session.resultsPublished) return false;
  return Date.parse(session.endsAt) + EXAM_LOCK_GRACE_MS > now;
}

export function hasExitedExam(assignmentId: string) {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(EXITED_PREFIX + assignmentId) === "1";
  } catch {
    return false;
  }
}

export function markExamExited(assignmentId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(EXITED_PREFIX + assignmentId, "1");
  } catch {
    /* ignore */
  }
  notifySchoolExamSession();
}

export function clearExamExited(assignmentId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(EXITED_PREFIX + assignmentId);
  } catch {
    /* ignore */
  }
}

const INTENTIONAL_SIGNOUT = "easyecon:intentional-signout";

export function markIntentionalSignOut() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(INTENTIONAL_SIGNOUT, "1");
  } catch {
    /* ignore */
  }
}

export function consumeIntentionalSignOut() {
  if (typeof window === "undefined") return false;
  try {
    const on = sessionStorage.getItem(INTENTIONAL_SIGNOUT) === "1";
    if (on) sessionStorage.removeItem(INTENTIONAL_SIGNOUT);
    return on;
  } catch {
    return false;
  }
}

export function isExamLocalEmail(email: string | null | undefined) {
  return !!email?.toLowerCase().endsWith("@exam.easyecon.local");
}

export function normalizeStudentName(name: string) {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
