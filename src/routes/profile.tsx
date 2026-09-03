import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Crown, Loader2, Save, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { ManualPayDialog } from "@/components/ManualPayDialog";
import { COMPANIONS, COMPANION_KEY, getCompanion, type CompanionId } from "@/lib/mascot-lines";
import { setActiveCompanion } from "@/lib/mascot-memory";
import { pingComeback, summarizeMemory } from "@/lib/mascot-memory";

const MILESTONE_LABEL: Record<string, string> = {
  first_answer: "第一题",
  answers_10: "10 题",
  answers_50: "50 题",
  answers_100: "破百",
  answers_500: "500 题",
  streak_3: "连击 3 天",
  streak_7: "连击 7 天",
  streak_30: "连击 30 天",
  first_frq: "首道大题",
  first_mock: "首次模考",
  accuracy_80: "正确率 80%",
  night_owl: "夜猫子",
  early_bird: "早起党",
  comeback: "回归",
};

type Membership = {
  isPro: boolean;
  plan: string | null;
  status: string | null;
  source: "paid" | "gift" | "lifetime" | "free";
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
  const [examDate, setExamDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [companionId, setCompanionId] = useState<CompanionId>("sarah");
  const [memory, setMemory] = useState(() => summarizeMemory());

  useEffect(() => {
    pingComeback();
    setMemory(summarizeMemory());
    function refresh() { setMemory(summarizeMemory()); }
    window.addEventListener("companion:milestone", refresh);
    return () => window.removeEventListener("companion:milestone", refresh);
  }, []);
  useEffect(() => {
    setCompanionId(getCompanion(localStorage.getItem(COMPANION_KEY)).id);
  }, []);

  function pickCompanion(id: CompanionId) {
    setCompanionId(id);
    setActiveCompanion(id);
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
      supabase.from("profiles").select("display_name,exam_date").eq("user_id", user.id).maybeSingle(),
      loadMembership(),
    ]).then(([profile, member]) => {
      setName(profile.data?.display_name ?? "");
      setExamDate((profile.data as { exam_date?: string | null } | null)?.exam_date ?? "");
      setMembership(member);
      setLoading(false);
    });
  }, [authLoading, user]);

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
      .update({ display_name: displayName, exam_date: examDate || null })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("保存失败，请稍后重试");
      return;
    }
    setName(displayName);
    toast.success("昵称已保存");
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
        <Link to="/" className="mb-0 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </Link>
        <h1 className="text-2xl font-bold">个人资料</h1>
        <p className="text-sm text-muted-foreground">登录后即可设置你的昵称。</p>
        <Button asChild><Link to="/auth" search={{ redirect: "/profile" }}>登录 / 注册</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回首页
      </Link>
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
          <div className="space-y-2">
            <Label htmlFor="exam-date">考试日期</Label>
            <Input id="exam-date" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">填了之后，学习伙伴会在考前主动提醒你节奏。</p>
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
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{membership?.source === "lifetime" ? "永久 Pro" : membership?.isPro ? "Pro 会员" : "免费用户"}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {membership?.isPro ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">AI 答疑</div><div className="mt-1 text-xl font-bold">{membership.usage.aiExplain}/{membership.usage.aiExplainLimit}</div></div>
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">FRQ 评分</div><div className="mt-1 text-xl font-bold">{membership.usage.frqGrade}/{membership.usage.frqGradeLimit}</div></div>
              </div>
              {membership.source === "lifetime" ? (
                <div className="text-sm">有效期：永久</div>
              ) : membership.currentPeriodEnd ? (
                <div className="text-sm">有效期至：{new Date(membership.currentPeriodEnd).toLocaleDateString()}</div>
              ) : null}
              {membership.source !== "lifetime" && <p className="text-xs text-muted-foreground">到期后可在 <Link to="/pricing" className="text-primary underline">定价页</Link> 再次扫码续费。</p>}
            </>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 3 次 AI 答疑</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 1 次大题 AI 评分</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />完整模考每 7 天 1 次</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <ManualPayDialog planKey="pro_monthly" trigger={<Button className="h-auto justify-between px-4 py-3"><span>月度会员</span><span>¥19/月</span></Button>} />
                <ManualPayDialog planKey="pro_quarterly" trigger={<Button className="h-auto justify-between px-4 py-3" variant="secondary"><span>季度会员</span><span>¥55/季</span></Button>} />
                <ManualPayDialog planKey="pro_yearly" trigger={<Button className="h-auto justify-between px-4 py-3" variant="outline"><span>年度会员</span><span className="flex items-center gap-1"><Sparkles className="h-4 w-4" />¥199/年</span></Button>} />
              </div>
              <p className="text-xs text-muted-foreground">支持微信 / 支付宝扫码付款，人工核对后开通。购买即表示同意 <Link to="/legal/terms" className="text-primary underline">服务条款</Link>、<Link to="/legal/refunds" className="text-primary underline">退款政策</Link>与 <Link to="/legal/privacy" className="text-primary underline">隐私声明</Link>。</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}