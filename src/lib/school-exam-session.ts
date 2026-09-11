const KEY = "easyecon:school-exam";

export type SchoolExamSession = {
  assignmentId: string;
  paperSlug: string;
  title: string;
  endsAt: string;
  submitted: boolean;
  resultsPublished: boolean;
};

export function loadSchoolExamSession(): SchoolExamSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchoolExamSession;
    if (!parsed?.assignmentId || !parsed.paperSlug) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSchoolExamSession(session: SchoolExamSession) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(session);
  sessionStorage.setItem(KEY, raw);
  localStorage.setItem(KEY, raw);
}

export function clearSchoolExamSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
}

export function isSchoolExamLocked(session: SchoolExamSession | null, now = Date.now()) {
  if (!session) return false;
  if (session.submitted && session.resultsPublished) return false;
  return new Date(session.endsAt).getTime() + 2 * 60 * 60 * 1000 > now;
}

export function normalizeStudentName(name: string) {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
