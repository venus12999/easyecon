import { createClient } from "@supabase/supabase-js";
import { isAdminEmailServer } from "./admin-emails.server";

/** 用 Bearer Supabase JWT 校验请求是否来自管理员账号。 */
export async function verifyAdminRequest(request: Request): Promise<boolean> {
  try {
    const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
    const jwt = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    if (!jwt) return false;
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return false;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data.user) return false;
    return isAdminEmailServer(data.user.email);
  } catch {
    return false;
  }
}