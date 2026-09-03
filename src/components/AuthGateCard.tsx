import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getRememberPreference, setRememberPreference } from "@/lib/remember-session";

const schema = z.object({
  email: z.string().trim().email("邮箱格式不正确").max(255),
  password: z.string().min(6, "密码至少 6 位").max(72),
});

export function AuthGateCard({ continuePath }: { continuePath: string }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(() => getRememberPreference());
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const emailRedirectTo =
    typeof window !== "undefined" ? `${window.location.origin}${continuePath}` : undefined;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "输入错误");
      return;
    }
    setBusy(true);
    try {
      if (tab === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo },
        });
        if (error) {
          if (/registered|exists/i.test(error.message)) toast.error("该邮箱已注册，请直接登录");
          else toast.error(error.message);
          return;
        }
        if (data.session) {
          setRememberPreference(remember);
          toast.success("注册成功，正在生成成绩…");
        } else {
          setPendingEmail(parsed.data.email);
          toast.success("验证邮件已发送，请前往邮箱点击链接后再回来查看成绩");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) {
          if (/confirm/i.test(error.message)) {
            setPendingEmail(parsed.data.email);
            toast.error("邮箱尚未验证，请先点击邮件中的验证链接");
          } else {
            toast.error("邮箱或密码错误");
          }
          return;
        }
        setRememberPreference(remember);
        toast.success("登录成功，正在生成成绩…");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-white/50 shadow-xl">
      <CardContent className="p-6">
        {pendingEmail ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">请先验证邮箱</p>
            <p className="text-xs text-muted-foreground">
              我们已把验证链接发到 <span className="font-medium text-foreground break-all">{pendingEmail}</span>
              。验证完成后再回到本页登录，即可查看成绩。
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={() => { setPendingEmail(null); setTab("login"); }}>
              已验证，返回登录
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-4">
              <form onSubmit={onSubmit} className="space-y-3">
                <Input
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="h-11"
                />
                <Input
                  type="password"
                  placeholder="密码（至少 6 位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === "register" ? "new-password" : "current-password"}
                  required
                  className="h-11"
                />
                <Label htmlFor="gate-remember" className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    id="gate-remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                  />
                  记住我（30 天内免登录）
                </Label>
                <Button type="submit" className="h-11 w-full" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "register" ? "注册并查看成绩" : "登录并查看成绩"}
                </Button>
                <Button asChild type="button" variant="link" className="h-auto w-full p-0 text-xs">
                  <Link to="/auth" search={{ redirect: continuePath }}>忘记密码？去登录页</Link>
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

export function MockResultAuthGate({
  continuePath,
  signedIn,
  revealing,
  revealError,
  onRetry,
  onDiscard,
}: {
  continuePath: string;
  signedIn: boolean;
  revealing: boolean;
  revealError: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">查看成绩请先登录</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        作答已保存。登录或注册后即可查看分数、解析和大题评分。
      </p>
      <div className="mt-6">
        {signedIn ? (
          revealError ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <p className="text-muted-foreground">成绩生成失败，请重试。大题评分需要登录且有剩余次数。</p>
                <Button className="w-full" onClick={onRetry}>重试</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {revealing ? "正在生成成绩…" : "登录成功，正在跳转到成绩页…"}
            </div>
          )
        ) : (
          <AuthGateCard continuePath={continuePath} />
        )}
      </div>
      <Button type="button" variant="ghost" className="mt-4 w-full text-muted-foreground" onClick={onDiscard}>
        放弃本次成绩
      </Button>
    </main>
  );
}
