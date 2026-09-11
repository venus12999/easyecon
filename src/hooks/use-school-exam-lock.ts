import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  isSchoolExamLocked,
  loadSchoolExamSession,
  type SchoolExamSession,
} from "@/lib/school-exam-session";

export function useSchoolExamLock() {
  const loc = useRouterState({ select: (r) => `${r.location.pathname}${r.location.searchStr}` });
  const [session, setSession] = useState<SchoolExamSession | null>(null);
  useEffect(() => {
    setSession(loadSchoolExamSession());
  }, [loc]);
  return { session, locked: isSchoolExamLocked(session) };
}
