import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

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

  useEffect(() => {
    if (user) nav({ to: "/" });
  }, [user, nav]);

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
          toast.success("注册成功，已自动登录");
          nav({ to: "/" });
        } else {
          toast.success("注册成功，请前往邮箱确认后登录");
          setTab("login");
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
        toast.success("登录成功");
        nav({ to: "/" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
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
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 justify-center mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="font-bold">APMicro 练习平台</div>
        </Link>
        <Card>
          <CardContent className="p-6">
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
                  />
                  {!forgot && <Input
                    type="password"
                    placeholder="密码（至少 6 位）"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={tab === "register" ? "new-password" : "current-password"}
                    required
                  />}
                  {forgot ? <Button type="button" className="w-full" disabled={busy} onClick={() => void sendReset()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}发送重设邮件</Button> : <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "register" ? "注册并登录" : "登录"}
                  </Button>}
                  {tab === "login" && <Button type="button" variant="link" className="h-auto w-full p-0 text-xs" onClick={() => setForgot((value) => !value)}>{forgot ? "返回密码登录" : "忘记密码？"}</Button>}
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}