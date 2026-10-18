import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

const EXAM_STORAGE_KEY = "easyecon-exam-auth";
const EXAM_TAB_FLAG = "easyecon-exam-auth-tab";

function examStorage() {
  const memory = new Map<string, string>();
  const live = typeof window !== "undefined";
  return {
    getItem(key: string) {
      if (!live) return memory.get(key) ?? null;
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string) {
      if (!live) {
        memory.set(key, value);
        return;
      }
      sessionStorage.setItem(key, value);
    },
    removeItem(key: string) {
      if (!live) {
        memory.delete(key);
        return;
      }
      sessionStorage.removeItem(key);
    },
  };
}

function createExamClient() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing Supabase environment variables.");
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: examStorage(),
      storageKey: EXAM_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

let examClient: ReturnType<typeof createExamClient> | undefined;

export function examSupabase() {
  if (!examClient) examClient = createExamClient();
  return examClient;
}

export function isExamTab() {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(EXAM_TAB_FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearExamTab() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(EXAM_TAB_FLAG);
  } catch {
    /* ignore */
  }
}

/** Sign the exam account into this tab only. The teacher session in localStorage stays put. */
export async function beginExamSession(accessToken: string, refreshToken: string) {
  if (typeof window === "undefined") return new Error("无法进入考场");
  sessionStorage.setItem(EXAM_TAB_FLAG, "1");
  const { error } = await examSupabase().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) clearExamTab();
  return error;
}

export async function activeAccessToken() {
  if (isExamTab()) {
    const { data } = await examSupabase().auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
