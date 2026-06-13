import { createFileRoute, Link } from "@tanstack/react-router";
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

type Membership = {
  isPro: boolean;
  plan: string | null;
  status: string | null;
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
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
      supabase.auth.getSession().then(async ({ data }) => {
        const token = data.session?.access_token;
        if (!token) return null;
        const response = await fetch("/api/membership", { headers: { Authorization: `Bearer ${token}` } });
        return response.ok ? (await response.json()) as Membership : null;
      }),
    ]).then(([profile, member]) => {
      setName(profile.data?.display_name ?? "");
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
      <Card className="overflow-hidden border-primary/25">
        <CardHeader className="bg-primary/5">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base"><Crown className="h-4 w-4 text-primary" />会员</CardTitle>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{membership?.isPro ? "Pro 会员" : "免费用户"}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {membership?.isPro ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">AI 答疑</div><div className="mt-1 text-xl font-bold">{membership.usage.aiExplain}/{membership.usage.aiExplainLimit}</div></div>
                <div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">FRQ 评分</div><div className="mt-1 text-xl font-bold">{membership.usage.frqGrade}/{membership.usage.frqGradeLimit}</div></div>
              </div>
              {membership.currentPeriodEnd && <div className="text-sm">{membership.cancelAtPeriodEnd ? "有效期至" : "下次续费"}：{new Date(membership.currentPeriodEnd).toLocaleDateString()}</div>}
              {membership.canManage && <Button variant="outline" onClick={() => void manageMembership()}>管理订阅</Button>}
            </>
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 30 次 AI 答疑</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />每天 10 次 FRQ 评分</div>
                <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />刷题和模考不限次</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button className="h-auto justify-between px-4 py-3" disabled={checkoutLoading} onClick={() => void openCheckout({ priceId: "ap_micro_pro_monthly", userId: user.id, email: user.email })}><span>月度会员</span><span>¥29/月</span></Button>
                <Button className="h-auto justify-between px-4 py-3" variant="outline" disabled={checkoutLoading} onClick={() => void openCheckout({ priceId: "ap_micro_pro_yearly", userId: user.id, email: user.email })}><span>年度会员</span><span className="flex items-center gap-1"><Sparkles className="h-4 w-4" />¥199/年</span></Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}