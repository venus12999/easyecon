import { useCallback, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import {
  clearSchoolExamSession,
  isExamLocalEmail,
  isSchoolExamLocked,
  loadSchoolExamSession,
  saveSchoolExamSession,
  type SchoolExamSession,
} from "@/lib/school-exam-session";

export function useSchoolExamLock() {
  const loc = useRouterState({ select: (r) => `${r.location.pathname}${r.location.searchStr}` });
  const { user, loading: authLoading } = useAuth();
  const [session, setSession] = useState<SchoolExamSession | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const local = loadSchoolExamSession();
    if (local) setSession(local);
    if (!user) {
      setSession(local);
      setReady(true);
      return;
    }
    try {
      const r = await authFetch("/api/exam/session");
      if (!r.ok) {
        setSession(local);
        setReady(true);
        return;
      }
      const j = (await r.json()) as {
        exam?: (SchoolExamSession & { locked?: boolean; studentName?: string; studentId?: string }) | null;
      };
      if (!j.exam) {
        if (isExamLocalEmail(user.email)) {
          setSession(local);
        } else {
          clearSchoolExamSession();
          setSession(null);
        }
        setReady(true);
        return;
      }
      const next: SchoolExamSession = {
        assignmentId: j.exam.assignmentId,
        paperSlug: j.exam.paperSlug,
        title: j.exam.title,
        endsAt: j.exam.endsAt,
        submitted: j.exam.submitted,
        resultsPublished: j.exam.resultsPublished,
        studentName: j.exam.studentName,
        studentId: j.exam.studentId,
      };
      saveSchoolExamSession(next);
      setSession(next);
    } catch {
      setSession(local);
    } finally {
      setReady(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, loc, refresh]);

  useEffect(() => {
    if (!session?.endsAt) return;
    const ms = Date.parse(session.endsAt) + 2 * 60 * 60 * 1000 - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(() => void refresh(), Math.min(ms + 250, 60_000));
    const poll = window.setInterval(() => void refresh(), 20_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
    };
  }, [session?.endsAt, session?.assignmentId, session?.submitted, session?.resultsPublished, refresh]);

  const locked = !!user && isSchoolExamLocked(session);

  return { session, locked, loading: authLoading || !ready, refresh };
}
