import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "fallback-admin-signing-key";
}

/** 简单的有签名+过期时间的 token，存于 sessionStorage。 */
export function signToken(ttlMs = 1000 * 60 * 60 * 8): string {
  const exp = Date.now() + ttlMs;
  const payload = `admin:${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [role, expStr, sig] = parts;
  if (role !== "admin") return false;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return false;
  const expected = createHmac("sha256", secret()).update(`${role}:${expStr}`).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}