import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Sparkles, ShieldCheck, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import logoAsset from "@/assets/logo.png.asset.json";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getRememberPreference, setRememberPreference } from "@/lib/remember-session";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "登录 / 注册 · AP 微观经济" }, { name: "robots", content: "noindex" }] }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("邮箱格式不正确").max(255),
  password: z.string().min(6, "密码至少 6 位").max(72),
});

function AuthPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (user) nav({ to: "/" });
  }, [user, nav]);

  useEffect(() => {
    setRemember(getRememberPreference());
  }, []);

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
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) {
          if (/registered|exists/i.test(error.message)) toast.error("该邮箱已注册，请直接登录");
          else toast.error(error.message);
          return;
        }
        if (data.session) {
          setRememberPreference(remember);
          toast.success("注册成功");
          nav({ to: "/" });
        } else {
          setPendingEmail(parsed.data.email);
          toast.success("验证邮件已发送，请前往邮箱点击链接完成注册");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) {
          toast.error("邮箱或密码错误");
          return;
        }
        setRememberPreference(remember);
        toast.success("登录成功");
        nav({ to: "/" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    void 0;
    const parsed = z.string().trim().email().safeParse(email);
    if (!parsed.success) return toast.error("请先输入有效邮箱");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) return toast.error("发送失败，请稍后重试");
    toast.success("如果该邮箱已注册，你将收到重设密码邮件");
    setForgot(false);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background flex items-center justify-center px-4 py-10">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute top-1/2 -right-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-card/60 p-2 shadow-lg ring-1 ring-border/60 backdrop-blur">
            <img src={logoAsset.url} alt="EasyEcon" className="h-12 w-12 rounded-xl" />
          </div>
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight">EasyEcon</div>
            <div className="mt-1 text-xs text-muted-foreground">AP 微观经济 · 智能练习平台</div>
          </div>
        </Link>

        <Card className="border-border/60 shadow-xl backdrop-blur-sm bg-card/95">
          <CardContent className="p-6">
            <div className="mb-4 text-center">
              <h1 className="text-lg font-semibold">
                {forgot ? "找回密码" : tab === "register" ? "创建账号" : "欢迎回来"}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {forgot ? "输入注册邮箱，我们会发送重设链接" : tab === "register" ? "注册后即可开始 AP 微观经济练习" : "继续你的学习进度"}
              </p>
            </div>
              <Tabs value={tab} onValueChange={(v) => { setTab(v as "login" | "register"); setForgot(false); }}>
              <TabsList className="grid grid-cols-2 w-full">
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
                  {!forgot && <Input
                    type="password"
                    placeholder="密码（至少 6 位）"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={tab === "register" ? "new-password" : "current-password"}
                    required
                    className="h-11"
                  />}
                  {!forgot && (
                    <div className="flex items-center justify-between pt-1">
                      <Label htmlFor="remember" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          id="remember"
                          checked={remember}
                          onCheckedChange={(v) => setRemember(v === true)}
                        />
                        记住我（30 天内免登录）
                      </Label>
                    </div>
                  )}
                  {forgot ? <Button type="button" className="w-full h-11" disabled={busy} onClick={() => void sendReset()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}发送重设邮件</Button> : <Button type="submit" className="w-full h-11" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "register" ? "注册并登录" : "登录"}
                  </Button>}
                  {tab === "login" && <Button type="button" variant="link" className="h-auto w-full p-0 text-xs" onClick={() => setForgot((value) => !value)}>{forgot ? "返回密码登录" : "忘记密码？"}</Button>}
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <BookOpen className="mx-auto mb-1 h-4 w-4 text-primary" />
            题库精选
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <Sparkles className="mx-auto mb-1 h-4 w-4 text-primary" />
            AI 讲解
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <ShieldCheck className="mx-auto mb-1 h-4 w-4 text-primary" />
            进度同步
          </div>
        </div>
      </div>
    </div>
  );
}