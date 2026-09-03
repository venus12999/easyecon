import { supabase } from "@/integrations/supabase/client";

export async function consumeMockAccess(
  examKey: string,
  action: "start" | "reveal" = "start",
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { ok: false, message: action === "reveal" ? "请先登录后查看成绩" : "登录状态已过期，请重新登录" };
  }
  const response = await fetch(`/api/membership/mock-access?exam_key=${encodeURIComponent(examKey)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const access = (await response.json().catch(() => ({}))) as {
    allowed?: boolean;
    nextAvailableAt?: string | null;
  };
  if (response.status === 401) {
    return { ok: false, message: action === "reveal" ? "请先登录后查看成绩" : "登录状态已过期，请重新登录" };
  }
  if (!response.ok) return { ok: false, message: "暂时无法校验模考次数，请稍后重试" };
  if (!access.allowed) {
    const date = access.nextAvailableAt ? new Date(access.nextAvailableAt).toLocaleString() : null;
    const verb = action === "reveal" ? "查看模考成绩" : "参加模考";
    return {
      ok: false,
      message: date
        ? `免费用户下次可于 ${date} ${verb}`
        : `免费用户每 7 天可参加 1 次完整模考，可在个人资料页升级会员`,
    };
  }
  return { ok: true };
}
