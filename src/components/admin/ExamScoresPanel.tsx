import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type ExamRow = {
  id: string;
  title: string;
  ends_at: string;
  class_name?: string;
  teacher_name?: string;
  roster_count?: number;
  submitted_count?: number;
  mcq_correct?: number;
  mcq_total?: number;
};

type ScoreFrq = {
  frq_id: string;
  sort_order: number;
  max_score: number;
  ai_score: number | null;
  manual_score: number | null;
  needs_review?: boolean;
};

type ScoreRow = {
  roster_id: string;
  student_id: string;
  student_name: string;
  status: string;
  submitted_at: string | null;
  mcq_correct: number | null;
  mcq_total: number | null;
  frqs?: ScoreFrq[];
};

function accuracy(exam: ExamRow) {
  if (!exam.mcq_total) return "—";
  return `${Math.round(((exam.mcq_correct ?? 0) / exam.mcq_total) * 100)}%`;
}

function frqLabel(frq: ScoreFrq) {
  const score = frq.manual_score ?? frq.ai_score;
  return score == null ? "—" : `${score}/${frq.max_score}`;
}

export function ExamScoresPanel({ token }: { token: string }) {
  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [openId, setOpenId] = useState("");
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/teacher/assignments", { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(body.error ?? "无法加载考试成绩");
        setExams([]);
        return;
      }
      setExams(body.assignments ?? []);
    } catch {
      toast.error("无法加载考试成绩");
      setExams([]);
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  async function openExam(id: string) {
    if (openId === id) {
      setOpenId("");
      setRows(null);
      return;
    }
    setOpenId(id);
    setRows(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/teacher/gradebook?assignment_id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(body.error ?? "无法打开这场成绩");
        setOpenId("");
        return;
      }
      setRows(body.rows ?? []);
    } finally {
      setBusy(false);
    }
  }

  if (!exams) {
    return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;
  }
  if (exams.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">还没有教师布置的考试。</p>;
  }

  const frqNumbers = [...new Set((rows ?? []).flatMap((row) => (row.frqs ?? []).map((frq) => frq.sort_order)))].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">每次考试结束后，这里和教师成绩册看到的是同一份分数。点一场考试展开全班，也可以打开教师成绩册查看答卷和评语。</p>
      {exams.map((exam) => {
        const open = openId === exam.id;
        return (
          <section key={exam.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-medium">{exam.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {exam.class_name ?? "班级"}{exam.teacher_name ? ` · ${exam.teacher_name}` : ""} · 截止 {new Date(exam.ends_at).toLocaleString()}
                  {" · "}提交 {exam.submitted_count ?? 0} / {exam.roster_count ?? 0}
                  {" · "}选择题正确率 {accuracy(exam)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void openExam(exam.id)}>
                  {open ? "收起成绩" : "查看成绩"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/teacher" search={{ page: "scores", exam: exam.id }}>打开成绩册</Link>
                </Button>
              </div>
            </div>
            {open && (
              <div className="mt-4 overflow-x-auto">
                {busy && <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>}
                {!busy && rows && rows.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">这场考试还没有学生名册。</p>}
                {!busy && rows && rows.length > 0 && (
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">学生</th>
                        <th className="py-2 pr-3 font-medium">状态</th>
                        <th className="py-2 pr-3 font-medium">选择题</th>
                        {frqNumbers.map((n) => <th key={n} className="py-2 pr-3 font-medium">Q{n}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.roster_id} className={row.frqs?.some((item) => item.needs_review) ? "border-t bg-amber-50" : "border-t"}>
                          <td className="py-2 pr-3">
                            <div>
                              {row.student_name}
                              {row.frqs?.some((item) => item.needs_review) ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">建议复核</span> : null}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">{row.student_id}</div>
                          </td>
                          <td className="py-2 pr-3">{row.status === "submitted" ? "已交卷" : row.status === "in_progress" ? "作答中" : "未交"}</td>
                          <td className="py-2 pr-3 tabular-nums">{row.mcq_total ? `${row.mcq_correct ?? 0}/${row.mcq_total}` : "—"}</td>
                          {frqNumbers.map((n) => {
                            const frq = row.frqs?.find((item) => item.sort_order === n);
                            return (
                              <td key={n} className={frq?.needs_review ? "bg-amber-100 py-2 pr-3 font-semibold tabular-nums text-amber-950" : "py-2 pr-3 tabular-nums"}>
                                {frq ? frqLabel(frq) : "—"}
                                {frq?.needs_review ? <div className="text-[10px] font-semibold">建议复核</div> : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
