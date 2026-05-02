// 前端用：判断当前登录用户邮箱是否为管理员（仅 UI 展示用，真正鉴权在服务端）。
// 默认硬编码所有者邮箱；如果需要新增请在数组中追加。
export const ADMIN_EMAILS = ["chenziyanyiyi@qq.com"];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}
