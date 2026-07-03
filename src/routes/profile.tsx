import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Crown, Loader2, Save, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { COMPANIONS, COMPANION_KEY, getCompanion, type CompanionId } from "@/lib/mascot-lines";
import { pingComeback, summarizeMemory } from "@/lib/mascot-memory";

type Membership = {
  isPro: boolean;
  plan: string | null;
  status: string | null;
  source: "paid" | "gift" | "free";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
  usage: { aiExplain: number; frqGrade: number; aiExplainLimit: number; frqGradeLimit: number };
};

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "个人资料 · AP Micro" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [syncingPayment, setSyncingPayment] = useState(false);
  const [companionId, setCompanionId] = useState<CompanionId>("sarah");
  const [memory, setMemory] = useState(() => summarizeMemory());

  useEffect(() => {
    pingComeback();
    setMemory(summarizeMemory());
    function refresh() { setMemory(summarizeMemory()); }
    window.addEventListener("companion:milestone", refresh);
    return () => window.removeEventListener("companion:milestone", refresh);
  }, []);
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();

  useEffect(() => {
    setCompanionId(getCompanion(localStorage.getItem(COMPANION_KEY)).id);
  }, []);

  function pickCompanion(id: CompanionId) {
    setCompanionId(id);
    try { localStorage.setItem(COMPANION_KEY, id); } catch {}
    window.dispatchEvent(new CustomEvent("companion:change", { detail: { id } }));
    toast.success(`已选择 ${getCompanion(id).name} 作为你的学习伙伴`);
  }

  async function loadMembership() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch("/api/membership", { headers: { Authorization: `Bearer ${token}` } });
    return response.ok ? await response.json() as Membership : null;
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
      loadMembership(),
    ]).then(([profile, member]) => {
      setName(profile.data?.display_name ?? "");
      setMembership(member);
      setLoading(false);
    });
  }, [authLoading, user]);

  useEffect(() => {
    if (!user || new URLSearchParams(window.location.search).get("checkout") !== "success") return;
    setSyncingPayment(true);
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void loadMembership().then((next) => {
        if (next) setMembership(next);
        if (next?.isPro || attempts >= 10) {
          window.clearInterval(timer);
          setSyncingPayment(false);
          navigate({ to: "/profile", replace: true });
          if (next?.isPro) toast.success("付款已确认，Pro 权益已生效");
          else toast.info("付款仍在同步，请稍后刷新查看");
        }
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [user, navigate]);

  async function saveProfile() {
    if (!user) return;
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > 40) {
      toast.error("昵称需为 1–40 个字符");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("保存失败，请稍后重试");
      return;
    }
    setName(displayName);
    toast.success("昵称已保存");
  }

  async function manageMembership() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/membership", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || !result.url) return toast.error("暂时无法打开订阅管理");
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function updateEmail() {
    if (!newEmail.trim()) return;
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() }, { emailRedirectTo: `${window.location.origin}/profile` });
    if (error) return toast.error(/registered|exists/i.test(error.message) ? "该邮箱已被使用" : "邮箱修改失败，请稍后重试");
    setNewEmail("");
    toast.success("确认邮件已发送到新邮箱，请完成确认");
  }

  async function updatePassword() {
    if (newPassword.length < 8) return toast.error("新密码至少 8 位");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return toast.error("密码修改失败，请稍后重试");
    setNewPassword("");
    toast.success("密码已更新");
  }

  if (authLoading || loading) {
    return <Loader2 className="mx-auto mt-16 h-5 w-5 animate-spin text-muted-foreground" />;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">个人资料</h1>
        <p className="text-sm text-muted-foreground">登录后即可设置你的昵称。</p>
        <Button asChild><Link to="/auth">登录 / 注册</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
          <UserRound className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">个人资料</h1>
          <p className="text-sm text-muted-foreground">设置你在平台中显示的名字</p>
        </div>
      </div>
      <Card className="mb-5">
        <CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="display-name">昵称</Label>
            <Input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 40))}
              placeholder="给自己取个名字"
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label>登录邮箱</Label>
            <Input value={user.email ?? ""} disabled />
          </div>
          <Button onClick={() => void saveProfile()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存资料
          </Button>
        </CardContent>
      </Card>
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">学习伙伴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {COMPANIONS.map((c) => {
              const active = c.id === companionId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickCompanion(c.id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                    active ? "border-primary bg-primary/5 ring-2 ring-primary/40" : "hover:border-primary/40"
                  }`}
                >
                  <img src={c.image} alt={c.name} className="h-16 w-16" style={{ imageRendering: "pixelated" }} />
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-xs text-muted-foreground leading-snug">{c.tagline}</div>
                  {active && <span className="text-[10px] font-semibold text-primary">当前伙伴</span>}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">伙伴记忆</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">累计答题</div>
              <div className="mt-1 text-lg font-bold">{memory.totalAnswers}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">正确率</div>
              <div className="mt-1 text-lg font-bold">{memory.accuracy}%</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">当前连击</div>
              <div className="mt-1 text-lg font-bold">{memory.streak} 天</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">最长连击</div>
              <div className="mt-1 text-lg font-bold">{memory.longestStreak} 天</div>
            </div>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">偏好单元</div>
              <div className="mt-1 font-semibold">{memory.favoriteUnit ? `Unit ${memory.favoriteUnit}` : "—"}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">常在时段</div>
              <div className="mt-1 font-semibold">{memory.activeHour ? `${memory.activeHour}:00 前后` : "—"}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">薄弱知识点</div>
              <div className="mt-1 font-semibold">{memory.weakCount} 个待巩固</div>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs text-muted-foreground">已解锁成就 · {memory.milestones.length}</div>
            {memory.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">先做一题，让伙伴记住你的第一步～</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {memory.milestones.map((m) => (
                  <span key={m} className="rounded-full border bg-primary/5 px-3 py-1 text-xs text-primary">{MILESTONE_LABEL[m] ?? m}</span>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="mb-5">
        <CardHeader><CardTitle className="text-base">账号安全</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="new-email">修改邮箱</Label><Input id="new-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="新邮箱地址" /><Button variant="outline" onClick={() => void updateEmail()} disabled={!newEmail.trim()}>发送确认邮件</Button></div>
          <div className="space-y-2"><Label htmlFor="new-account-password">修改密码</Label><Input id="new-account-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" /><Button variant="outline" onClick={() => void updatePassword()} disabled={!newPassword}>保存新密码</Button></div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden border-primary/25">
        <CardHeader className="bg-primary/5">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base"><Crown className="h-4 w-4 text-primary" />会员</CardTitle>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{membership?.isPro ? "Pro 会员" : "免费用户"}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {syncingPayment && <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />付款成功，正在确认会员权益…</div>}
          {membership?.status === "past_due" && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">续费付款失败，Pro 权益已暂停。请打开订阅管理更新付款方式。</div>}
          {membership?.status === "paused" && <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">订阅已暂停，当前不享受 Pro 权益。</div>}
          {membership?.isPro ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">AI 答疑</div><div className="mt-1 text-xl font-bold">{membership.usage.aiExplain}/{membership.usage.aiExplainLimit}</div></div>
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">FRQ 评分</div><div className="mt-1 text-xl font-bold">{membership.usage.frqGrade}/{membership.usage.frqGradeLimit}</div></div>
              </div>
              <div className="text-sm text-muted-foreground">权益来源：{membership.source === "gift" ? "管理员赠送" : membership.plan === "ap_micro_pro_yearly" ? "年度会员" : membership.plan === "ap_micro_pro_quarterly" ? "季度会员" : "月度会员"}</div>
              {membership.currentPeriodEnd && <div className="text-sm">{membership.source === "gift" || membership.cancelAtPeriodEnd ? "有效期至" : "下次续费"}：{new Date(membership.currentPeriodEnd).toLocaleDateString()}</div>}
              {membership.canManage && <Button variant="outline" onClick={() => void manageMembership()}>管理订阅</Button>}
            </>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 30 次 AI 答疑</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 10 次 FRQ 评分</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />刷题和模考不限次</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button className="h-auto justify-between px-4 py-3" disabled={checkoutLoading} onClick={() => void openCheckout({ priceId: "ap_micro_pro_monthly", userId: user.id, email: user.email })}><span>月度会员</span><span>¥19/月</span></Button>
                <Button className="h-auto justify-between px-4 py-3" variant="secondary" disabled={checkoutLoading} onClick={() => void openCheckout({ priceId: "ap_micro_pro_quarterly", userId: user.id, email: user.email })}><span>季度会员</span><span>¥55/季</span></Button>
                <Button className="h-auto justify-between px-4 py-3" variant="outline" disabled={checkoutLoading} onClick={() => void openCheckout({ priceId: "ap_micro_pro_yearly", userId: user.id, email: user.email })}><span>年度会员</span><span className="flex items-center gap-1"><Sparkles className="h-4 w-4" />¥199/年</span></Button>
              </div>
              <p className="text-xs text-muted-foreground">购买即表示同意 <Link to="/legal/terms" className="text-primary underline">服务条款</Link>、<Link to="/legal/refunds" className="text-primary underline">14 天退款政策</Link>与 <Link to="/legal/privacy" className="text-primary underline">隐私声明</Link>。付款由 Paddle 安全处理。</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}