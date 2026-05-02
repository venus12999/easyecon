// 服务端用：管理员邮箱白名单（真鉴权）。
// 优先读环境变量 ADMIN_EMAILS（逗号分隔），未设置则用默认所有者邮箱。
const DEFAULT_ADMIN_EMAILS = ["chenziyanyiyi@qq.com"];

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ADMIN_EMAILS;
  return list.map((e) => e.toLowerCase());
}

export function isAdminEmailServer(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
