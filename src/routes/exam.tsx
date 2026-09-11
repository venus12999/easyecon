import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveSchoolExamSession } from "@/lib/school-exam-session";

export const Route = createFileRoute("/exam")({
  head: () => ({ meta: [{ title: "学校考试入场" }, { name: "robots", content: "noindex" }] }),
  component: ExamEntry,
});

function ExamEntry() {
  const nav = useNavigate();
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [examCode, setExamCode] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "学校考试入场";
  }, []);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/exam/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          student_name: studentName,
          exam_code: examCode,
          password,
          email: email.trim() || undefined,
        }),
      });
      const j = (await r.json()) as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
        assignment?: { id: string; title: string; ends_at: string; results_published: boolean };
        paper?: { slug: string; title: string };
        attempt?: { submitted: boolean } | null;
      };
      if (!r.ok || !j.access_token || !j.refresh_token || !j.assignment || !j.paper) {
        toast.error(j.error ?? "入场失败");
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: j.access_token,
        refresh_token: j.refresh_token,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      saveSchoolExamSession({
        assignmentId: j.assignment.id,
        paperSlug: j.paper.slug,
        title: j.assignment.title,
        endsAt: j.assignment.ends_at,
        submitted: !!j.attempt?.submitted,
        resultsPublished: j.assignment.results_published,
      });
      await nav({
        to: "/mock/$slug",
        params: { slug: j.paper.slug },
        search: { assignment: j.assignment.id },
      });
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">学校考试入场</h1>
      <p className="text-sm text-muted-foreground mb-6">填写花名册上的学号、姓名，以及老师公布的考试码。第一次入场请设置密码，断网后可用同一学号继续未交卷。</p>
      <Card>
        <CardContent className="p-5">
          <form className="space-y-3" onSubmit={(e) => void enter(e)}>
            <div>
              <label className="text-xs text-muted-foreground">学号</label>
              <Input value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">姓名（须与花名册一致）</label>
              <Input value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">考试码</label>
              <Input
                value={examCode}
                onChange={(e) => setExamCode(e.target.value.toUpperCase())}
                className="tracking-[0.3em] font-mono uppercase"
                maxLength={8}
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">密码（至少 6 位）</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required minLength={6} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">学校邮箱（可选）</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="没有可留空" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              进入考场
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
