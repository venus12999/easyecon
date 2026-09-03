import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { hydrateSessionOnlyToken, installSessionOnlyPersistence } from "@/lib/remember-session";
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
    const publicPaths = ["/auth", "/reset-password", "/pricing", "/legal", "/terms", "/privacy"];
    const isPublic = () => {
      const p = typeof window !== "undefined" ? window.location.pathname : "/";
      return publicPaths.some((x) => p === x || p.startsWith(x + "/"));
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      // 登录后异步迁移本地数据
      if (s?.user) {
        hadSession = true;
        setTimeout(() => {
          import("@/lib/migrate-local").then((m) => m.migrateLocalToCloud(s.user.id)).catch(() => {});
          import("@/lib/mascot-memory").then((m) => m.hydrateMascotFromCloud(s.user.id)).catch(() => {});
        }, 0);
        return;
      }
      // 会话失效：SIGNED_OUT 或 TOKEN_REFRESHED 返回空 session
      if ((event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") && !s) {
        if (hadSession && !isPublic()) {
          toast.error("登录已过期，请重新登录");
          const from = window.location.pathname + window.location.search;
          router.navigate({ to: "/auth", search: { redirect: from } as never, replace: true });
        }
        hadSession = false;
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      hadSession = !!data.session;
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
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