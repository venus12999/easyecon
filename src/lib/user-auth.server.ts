import { createClient } from "@supabase/supabase-js";

/** 校验请求是否带有效 Supabase JWT，返回用户 id（失败返回 null）。 */
export async function verifyUserRequest(request: Request): Promise<{ userId: string; email: string | null; jwt: string } | null> {
  try {
    const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
    const jwt = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    if (!jwt) return null;
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return null;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null, jwt };
  } catch {
    return null;
  }
}

/** User-scoped client (RLS applies). Use for the caller's own rows so membership display works without a service role key. */
export function createUserScopedClient(jwt: string) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase URL or anon key");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}