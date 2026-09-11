import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useSchoolExamLock } from "@/hooks/use-school-exam-lock";
import { isExamLocalEmail } from "@/lib/school-exam-session";

export function SchoolExamGuard({ children }: { children: ReactNode }) {
  const { locked, session, loading } = useSchoolExamLock();
  const { user } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const searchStr = useRouterState({ select: (r) => r.location.searchStr });
  const nav = useNavigate();

  useEffect(() => {
    if (loading || !locked || !session) return;
    const examAccount = isExamLocalEmail(user?.email);
    const allowed =
      path === "/exam" ||
      path === "/auth" ||
      path === "/reset-password" ||
      path.startsWith("/legal") ||
      (!examAccount && (path.startsWith("/teacher") || path.startsWith("/admin"))) ||
      (path === `/mock/${session.paperSlug}` && searchStr.includes(session.assignmentId));
    if (allowed) return;
    void nav({
      to: "/mock/$slug",
      params: { slug: session.paperSlug },
      search: { assignment: session.assignmentId },
      replace: true,
    });
  }, [loading, locked, session, path, searchStr, nav, user?.email]);

  return children;
}
