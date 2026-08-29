/** 永久 Pro 白名单。这些邮箱不走付费订阅/赠送天数，始终视为 VIP。 */
export const LIFETIME_VIP_EMAILS = ["chenziyanyiyi@qq.com"];

export function isLifetimeVipEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return LIFETIME_VIP_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}
