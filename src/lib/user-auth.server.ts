import { createClient } from "@supabase/supabase-js";
import { installOutboundProxy } from "@/lib/outbound-proxy.server";

function supabasePublicEnv() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_URL;
  const anon =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { url, anon };
}

export type VerifiedUser = { userId: string; email: string | null; jwt: string };

async function readSession(request: Request): Promise<VerifiedUser | "expired" | null> {
  try {
    const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
    const jwt = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    if (!jwt) return null;
    await installOutboundProxy();
    const { url, anon } = supabasePublicEnv();
    if (!url || !anon) return null;
    const sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data.user) {
      const message = error?.message ?? "";
      if (error?.name === "AuthRetryableFetchError" || /fetch failed|network|ECONNRESET|UND_ERR/i.test(message)) {
        return "unavailable";
      }
      if (error?.name === "AuthSessionMissingError" || message === "Auth session missing!") return "expired";
      return null;
    }
    return { userId: data.user.id, email: data.user.email ?? null, jwt };
  } catch {
    return "unavailable";
  }
}

/** 校验请求是否带有效 Supabase JWT，返回用户 id（失败返回 null）。 */
export async function verifyUserRequest(request: Request): Promise<VerifiedUser | null> {
  const user = await readSession(request);
  if (user === "expired" || user === "unavailable") return null;
  return user;
}

export async function verifyUserRequestDetailed(request: Request) {
  return readSession(request);
}

/** User-scoped client (RLS applies). Use for the caller's own rows so membership display works without a service role key. */
export function createUserScopedClient(jwt: string) {
  const { url, anon } = supabasePublicEnv();
  if (!url || !anon) throw new Error("Missing Supabase URL or anon key");
  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: undefined,
    },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}