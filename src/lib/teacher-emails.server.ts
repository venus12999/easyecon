// 服务端教师邮箱白名单。数据库里的 teacher 角色仍是正式授权；
// 白名单让这些账号在角色行写入之前也能进入教师端。
const TEACHER_EMAILS = ["liangdian666888@gmail.com"];

export function isTeacherEmailServer(email: string | null | undefined): boolean {
  if (!email) return false;
  return TEACHER_EMAILS.includes(email.toLowerCase());
}
