// "记住我" 会话策略：勾选 → localStorage（跨浏览器会话持久，默认 supabase 行为）
// 未勾选 → 把 supabase auth token 从 localStorage 迁移到 sessionStorage，
// 关闭浏览器/标签页后自动清除；下次打开无 token → 需要重新登录。
// 应用启动时若发现 sessionStorage 存有 token 而 localStorage 缺失，
// 则暂时回填 localStorage 以便 supabase 客户端读取。

const PROJECT_REF = "umyzlbrjnklkpxmbdhvf";
export const SUPABASE_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
export const REMEMBER_KEY = "auth-remember-me";
const SESSION_ONLY_FLAG = "auth-session-only";

export function setRememberPreference(remember: boolean) {
  try {
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, "1");
      sessionStorage.removeItem(SESSION_ONLY_FLAG);
    } else {
      localStorage.setItem(REMEMBER_KEY, "0");
      sessionStorage.setItem(SESSION_ONLY_FLAG, "1");
      // 立即把 token 从 localStorage 迁移到 sessionStorage
      const token = localStorage.getItem(SUPABASE_STORAGE_KEY);
      if (token) {
        sessionStorage.setItem(SUPABASE_STORAGE_KEY, token);
        localStorage.removeItem(SUPABASE_STORAGE_KEY);
      }
    }
  } catch {}
}

export function getRememberPreference(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch {
    return true;
  }
}

// 在 supabase 客户端初始化前调用：把 sessionStorage 的 token 暂时挪回 localStorage
export function hydrateSessionOnlyToken() {
  if (typeof window === "undefined") return;
  try {
    const sessionOnly = sessionStorage.getItem(SESSION_ONLY_FLAG) === "1";
    const sessionToken = sessionStorage.getItem(SUPABASE_STORAGE_KEY);
    if (sessionOnly && sessionToken && !localStorage.getItem(SUPABASE_STORAGE_KEY)) {
      localStorage.setItem(SUPABASE_STORAGE_KEY, sessionToken);
    }
    // 若用户上一次未勾选"记住我"但当前 sessionStorage 已被清空（关闭浏览器后重开），
    // 也要把 localStorage 里遗留的 token 清掉，强制重新登录。
    if (
      localStorage.getItem(REMEMBER_KEY) === "0" &&
      !sessionStorage.getItem(SESSION_ONLY_FLAG)
    ) {
      localStorage.removeItem(SUPABASE_STORAGE_KEY);
    }
  } catch {}
}

// 每次刷新前把 token 再同步回 sessionStorage，保证下次刷新时 hydrate 能找到。
export function installSessionOnlyPersistence() {
  if (typeof window === "undefined") return;
  const sync = () => {
    try {
      if (sessionStorage.getItem(SESSION_ONLY_FLAG) !== "1") return;
      const token = localStorage.getItem(SUPABASE_STORAGE_KEY);
      if (token) sessionStorage.setItem(SUPABASE_STORAGE_KEY, token);
    } catch {}
  };
  window.addEventListener("pagehide", sync);
  window.addEventListener("beforeunload", sync);
}
