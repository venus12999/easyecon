import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearExamTab, examSupabase, isExamTab } from "@/lib/exam-auth";
import { hydrateSessionOnlyToken, installSessionOnlyPersistence } from "@/lib/remember-session";
import { consumeIntentionalSignOut } from "@/lib/school-exam-session";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    hydrateSessionOnlyToken();
    installSessionOnlyPersistence();
    let hadSession = false;
    const publicPaths = ["/auth", "/reset-password", "/pricing", "/legal", "/terms", "/privacy", "/exam"];
    const isPublic = () => {
      const p = typeof window !== "undefined" ? window.location.pathname : "/";
      return publicPaths.some((x) => p === x || p.startsWith(x + "/"));
    };
    const rememberUser = (s: Session) => {
      const registeredName = typeof s.user.user_metadata?.display_name === "string" ? s.user.user_metadata.display_name.trim() : "";
      setTimeout(() => {
        import("@/lib/migrate-local").then((m) => m.migrateLocalToCloud(s.user.id)).catch(() => {});
        import("@/lib/mascot-memory").then((m) => m.hydrateMascotFromCloud(s.user.id)).catch(() => {});
        if (registeredName && !s.user.email?.endsWith("@exam.easyecon.local")) {
          void supabase.from("profiles").update({ display_name: registeredName }).eq("user_id", s.user.id).is("display_name", null);
        }
      }, 0);
    };
    const { data: mainSub } = supabase.auth.onAuthStateChange((event, s) => {
      if (isExamTab()) return;
      setSession(s);
      setLoading(false);
      if (s?.user) {
        hadSession = true;
        rememberUser(s);
        return;
      }
      if ((event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && !s) {
        if (consumeIntentionalSignOut()) {
          hadSession = false;
          return;
        }
        if (hadSession && !isPublic()) {
          toast.error("登录已过期，请重新登录");
          const from = window.location.pathname + window.location.search;
          router.navigate({ to: "/auth", search: { redirect: from } as never, replace: true });
        }
        hadSession = false;
      }
    });
    const onTeacherConsole = () => {
      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      return path === "/teacher" || path.startsWith("/teacher/") || path === "/admin" || path.startsWith("/admin/");
    };
    const restoreTeacherSession = () => {
      clearExamTab();
      void supabase.auth.getSession().then(({ data }) => {
        if (!isExamTab()) setSession(data.session);
      });
    };
    const { data: examSub } = examSupabase().auth.onAuthStateChange((event, s) => {
      if (!isExamTab()) return;
      if (onTeacherConsole()) {
        restoreTeacherSession();
        setLoading(false);
        return;
      }
      setSession(s);
      setLoading(false);
      if (s?.user) return;
      if (event !== "SIGNED_OUT" && event !== "TOKEN_REFRESHED" && event !== "USER_UPDATED") return;
      if (consumeIntentionalSignOut()) {
        void supabase.auth.getSession().then(({ data }) => {
          if (!isExamTab()) setSession(data.session);
        });
        return;
      }
      clearExamTab();
      toast.error("登录已过期，请重新登录");
      router.navigate({ to: "/exam", replace: true });
      void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    });
    void (async () => {
      const examOn = isExamTab();
      const [{ data: main }, exam] = await Promise.all([
        supabase.auth.getSession(),
        examOn ? examSupabase().auth.getSession() : Promise.resolve({ data: { session: null as Session | null } }),
      ]);
      if (examOn && exam.data.session && !onTeacherConsole()) {
        setSession(exam.data.session);
      } else {
        if (examOn) clearExamTab();
        setSession(main.session);
        hadSession = !!main.session;
      }
      setLoading(false);
    })();
    return () => {
      mainSub.subscription.unsubscribe();
      examSub.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          if (isExamTab()) {
            consumeIntentionalSignOut();
            clearExamTab();
            await examSupabase().auth.signOut();
            const { data } = await supabase.auth.getSession();
            setSession(data.session);
            return;
          }
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}