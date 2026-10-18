import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Sparkles, ShieldCheck, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { LOGO_URL } from "@/lib/brand";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getRememberPreference, setRememberPreference } from "@/lib/remember-session";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { authFetch } from "@/lib/auth-fetch";
import { isAdminEmail } from "@/lib/admin-emails";
import { isExamLocalEmail, loadSchoolExamSession } from "@/lib/school-exam-session";

type Audience = "student" | "teacher";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "登录 / 注册 · AP 微观经济" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string; role?: Audience } => ({
    redirect: safeRedirectPath(search.redirect),
    role: search.role === "teacher" || search.role === "student" ? search.role : undefined,
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("邮箱格式不正确").max(255),
  password: z.string().min(6, "密码至少 6 位").max(72),
});

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);
const confirmLocks = new Set<string>();

function confirmRedirect(nextPath: string) {
  return `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`;
}

function AuthPage() {
  const nav = useNavigate();
  const router = useRouter();
  const { redirect, role } = Route.useSearch();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [audience, setAudience] = useState<Audience>(role === "teacher" || redirect === "/teacher" ? "teacher" : "student");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const teacherEntry = audience === "teacher";
  const examAccount = isExamLocalEmail(user?.email);
  const examSession = examAccount ? loadSchoolExamSession() : null;
  const announceAuth = useRef<string | null>(null);

  function studentPath() {
    const path = safeRedirectPath(redirect);
    if (!path || path === "/teacher") return "/";
    return path;
  }

  async function goAfterAuth(announce: string | null, keepSession = false, email?: string | null) {
    if (teacherEntry) {
      const { data: sessionData } = await supabase.auth.getSession();
      const signedInEmail = email ?? sessionData.session?.user.email ?? user?.email;
      if (isExamLocalEmail(signedInEmail)) {
        toast.error("考试账号不能进入教师工作台");
        return;
      }
      // 管理员账号选教师就进工作台。校验失败也不能写成「这是学生账号」，更不能把刚登录的会话清掉。
      if (!isAdminEmail(signedInEmail)) {
        const response = await authFetch("/api/teacher/class?probe=1");
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (body.error === "unavailable") {
            toast.error("暂时连不上教师校验，请再试一次");
            return;
          }
          if (body.error === "session_expired") {
            if (!keepSession) await supabase.auth.signOut();
            toast.error("登录状态已失效，请再登录一次");
            return;
          }
          if (!keepSession) await supabase.auth.signOut();
          toast.error(keepSession ? "这个账号是学生账号，没有教师工作台。" : "这是学生账号，没有教师端。请改选「学生」登录。");
          return;
        }
      }
      if (announce) toast.success(announce);
      router.history.push("/teacher");
      return;
    }
    if (announce) toast.success(announce);
    const path = studentPath();
    if (path === "/") void nav({ to: "/" });
    else router.history.push(path);
  }

  async function continueSession() {
    setBusy(true);
    try {
      await goAfterAuth(null, true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!user || isExamLocalEmail(user.email)) return;
    const announce = announceAuth.current;
    if (announce) {
      announceAuth.current = null;
      void goAfterAuth(announce);
      return;
    }
    const next = safeRedirectPath(new URLSearchParams(window.location.search).get("next"));
    if (!next || new URLSearchParams(window.location.search).has("token_hash")) return;
    router.history.push(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    setRemember(getRememberPreference());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (!tokenHash || confirmLocks.has(tokenHash)) return;
    confirmLocks.add(tokenHash);
    const rawType = params.get("type");
    const otpType: EmailOtpType = rawType && OTP_TYPES.has(rawType as EmailOtpType) ? (rawType as EmailOtpType) : "signup";
    const next = safeRedirectPath(params.get("next"));
    setConfirming(true);
    setConfirmError("");
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType }).then(({ error }) => {
      if (error) {
        confirmLocks.delete(tokenHash);
        setConfirming(false);
        setConfirmError("这个验证链接无效，或已经用过。请重新发送验证邮件。");
        return;
      }
      window.history.replaceState({}, "", "/auth");
      if (next) {
        router.history.push(next);
        return;
      }
      void nav({ to: "/" });
    });
  }, [nav, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tab === "register" && !forgot) {
      const name = displayName.trim();
      if (!name) {
        toast.error("请填写姓名");
        return;
      }
      if (name.length > 40) {
        toast.error("姓名不超过 40 字");
        return;
      }
    }
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "输入错误");
      return;
    }
    setBusy(true);
    try {
      if (tab === "register") {
        const name = displayName.trim();
        const nextPath = teacherEntry ? "/teacher" : studentPath();
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: confirmRedirect(nextPath),
            data: { account_role: audience, display_name: name },
          },
        });
        if (error) {
          if (/registered|exists/i.test(error.message)) toast.error("该邮箱已注册，请直接登录");
          else toast.error(error.message);
          return;
        }
        if (data.session && data.user) {
          await supabase.from("profiles").update({ display_name: name }).eq("user_id", data.user.id);
          setRememberPreference(remember);
          announceAuth.current = null;
          await goAfterAuth("注册成功", false, data.user.email ?? parsed.data.email);
        } else {
          setPendingEmail(parsed.data.email);
          toast.success("注册成功，验证邮件已发送");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
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
        announceAuth.current = null;
        await goAfterAuth("登录成功", false, data.user?.email ?? parsed.data.email);
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

  async function resendVerification() {
    if (!pendingEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: confirmRedirect(teacherEntry ? "/teacher" : "/") },
    });
    setBusy(false);
    if (error) return toast.error("发送失败，请稍后重试");
    toast.success("验证邮件已重新发送");
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex flex-col items-center gap-3">
          <div className="rounded-2xl p-2 shadow-lg ring-1 ring-white/70 glass">
            <img src={LOGO_URL} alt="EasyEcon" className="h-12 w-12 rounded-xl object-cover" />
          </div>
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight">EasyEcon</div>
            <div className="mt-1 text-xs text-muted-foreground">AP 微观经济 · 智能练习平台</div>
          </div>
        </Link>

        <Card className="border-white/50 shadow-xl">
          <CardContent className="p-6">
            {!pendingEmail && !confirming && !examAccount && (
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1">
                <button
                  type="button"
                  onClick={() => setAudience("student")}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${audience === "student" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  学生
                </button>
                <button
                  type="button"
                  onClick={() => setAudience("teacher")}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${audience === "teacher" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  教师
                </button>
              </div>
            )}
            <div className="mb-4 text-center">
              <h1 className="text-lg font-semibold">
                {examAccount
                  ? "考试进行中"
                  : confirming
                  ? "正在确认邮箱"
                  : pendingEmail
                  ? "注册成功，请验证邮箱"
                  : forgot
                    ? "找回密码"
                    : teacherEntry
                      ? tab === "register" ? "教师注册" : "教师登录"
                      : tab === "register" ? "学生注册" : "学生登录"}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {examAccount
                  ? "回到考场继续作答。截止时间到了会自动交卷。"
                  : confirming
                  ? "马上就好，确认后会自动进入。"
                  : pendingEmail
                  ? `验证邮件已发到 ${pendingEmail}。打开邮件，点确认按钮，会自动回到本站。没看到邮件时，先看垃圾箱。`
                  : forgot
                    ? "输入注册邮箱，我们会发送重设链接"
                    : teacherEntry
                      ? "注册时选择教师，这个账号就会进入工作台。学生账号仍然只用学习主界面。"
                      : tab === "register" ? "注册后进入学习主界面，开始 AP 微观经济练习" : "登录后继续你的学习进度"}
              </p>
            </div>
            {confirmError && !confirming && (
              <p className="mb-3 text-center text-sm text-destructive">{confirmError}</p>
            )}
            {confirming ? (
              <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                正在确认邮箱
              </div>
            ) : pendingEmail ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-center text-sm font-medium break-all">
                  {pendingEmail}
                </div>
                <p className="text-xs text-muted-foreground">
                  没收到邮件？请检查垃圾邮件文件夹，或重新发送。
                </p>
                <Button type="button" className="h-11 w-full" disabled={busy} onClick={() => void resendVerification()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}重新发送验证邮件
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto w-full p-0 text-xs"
                  onClick={() => { setPendingEmail(null); setTab("login"); setPassword(""); }}
                >
                  已验证，返回登录
                </Button>
              </div>
            ) : examAccount ? (
              <div className="space-y-3">
                <p className="text-center text-sm text-muted-foreground">你正在一场考试里。回到考场继续作答。</p>
                {examSession?.paperSlug ? (
                  <Button
                    type="button"
                    className="h-11 w-full"
                    onClick={() => router.history.push(`/mock/${examSession.paperSlug}?assignment=${examSession.assignmentId}`)}
                  >
                    返回考场
                  </Button>
                ) : (
                  <Button type="button" className="h-11 w-full" onClick={() => void nav({ to: "/exam" })}>
                    返回考场入口
                  </Button>
                )}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto w-full p-0 text-xs"
                  onClick={() => void signOut()}
                >
                  退出这场考试
                </Button>
              </div>
            ) : user ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-center text-sm break-all">
                  当前账号 {user.email}
                </div>
                <Button type="button" className="h-11 w-full" disabled={busy} onClick={() => void continueSession()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {teacherEntry ? "进入教师工作台" : "进入学习主界面"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto w-full p-0 text-xs"
                  onClick={() => void signOut()}
                >
                  使用其他账号登录
                </Button>
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => { setTab(v as "login" | "register"); setForgot(false); }}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>
              <TabsContent value={tab} className="mt-4">
                <form noValidate onSubmit={onSubmit} className="space-y-3">
                  {tab === "register" && !forgot && (
                    <Input
                      type="text"
                      placeholder="姓名"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      autoComplete="name"
                      maxLength={40}
                      className="h-11"
                    />
                  )}
                  {tab === "register" && !forgot && (
                    <p className="text-[11px] text-muted-foreground">
                      {teacherEntry ? "这个姓名会显示在教师工作台。" : "请填真实姓名，老师在成绩册里靠它认出你。"}
                    </p>
                  )}
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
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === "register" ? "注册" : "登录"}
                  </Button>}
                  {tab === "login" && <Button type="button" variant="link" className="h-auto w-full p-0 text-xs" onClick={() => setForgot((value) => !value)}>{forgot ? "返回密码登录" : "忘记密码？"}</Button>}
                </form>
              </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <BookOpen className="mx-auto mb-1 h-4 w-4 text-primary" />
            {teacherEntry ? "布置考试" : "题库精选"}
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <Sparkles className="mx-auto mb-1 h-4 w-4 text-primary" />
            {teacherEntry ? "花名册" : "AI 讲解"}
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2 py-3 backdrop-blur">
            <ShieldCheck className="mx-auto mb-1 h-4 w-4 text-primary" />
            {teacherEntry ? "成绩册" : "进度同步"}
          </div>
        </div>
      </div>
    </div>
  );
}