import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Clock,
  Eye,
  FileUp,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { isAdminEmail } from "@/lib/admin-emails";
import { isBlankStudentAnswer } from "@/lib/frq-answer";
import { beijingInputLabel, beijingInputToIso, beijingTime, toBeijingInput } from "@/lib/beijing-time";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { applyKnownApAnswerKey, fillOptionEFrom, looksLikeProvidedFigure, parseApExamPages, readableFrqLabel, readPrintedScore, studentVisibleQuestion, withUniqueQuestionNumbers, type ParsedExamItem } from "@/lib/ap-exam-parse";
import { CUSTOM_SCORE_MAX_DEFAULT, apBasisText, apDistributionText, apMicroScore, apScoreText, formatScaledScore, pointsOnScale, scoreMaxError, summarizeApScores, type ApClassSummary, type ApScore } from "@/lib/ap-score";
import { ap2025Clock } from "@/lib/ap-2025-paper";
import { BREAK_MINUTES_DEFAULT, FRQ_MINUTES_DEFAULT, MCQ_MINUTES_DEFAULT, sectionMinutesError, sectionTimingLabel, sectionTotalMinutes } from "@/lib/exam-sections";
import { splitTeacherFrq } from "@/lib/frq-teacher-fields";
import { cropImageBlob, cropRectsForQuestions, cropUrlFromPage } from "@/lib/exam-page-crop";
import { PageCropDialog } from "@/components/teacher/PageCropDialog";
import { PdfQuestionList, type PdfAiFinding, type TeacherPdfItem } from "@/components/teacher/PdfQuestionList";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAccountLabel } from "@/lib/display-name";
import { mediaSrcRetry } from "@/lib/media-src";

async function assertStoredImage(url: string) {
  let detail = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(mediaSrcRetry(url, attempt), { cache: "no-store" });
    if (res.ok) {
      await res.body?.cancel();
      return;
    }
    detail = await res.text().catch(() => "");
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (detail.includes("Object not found") || detail.includes("NoSuchKey") || detail.includes("not found")) {
    throw new Error("页图没有写进存储（读取返回文件不存在）");
  }
  throw new Error("页图读取失败");
}

function assignmentUpload(importId: string, filename: string, blob: Blob) {
  const fd = new FormData();
  fd.append("file", new File([blob], filename, { type: blob.type || "image/png" }));
  fd.append("import_id", importId);
  const crop = filename.match(/^(mcq|frq)-(\d+)\.png$/i);
  if (crop) {
    fd.append("crop_kind", crop[1].toLowerCase());
    fd.append("sort_order", crop[2]);
  } else {
    const pageNumber = filename.match(/page-(\d+)/i)?.[1];
    if (!pageNumber) throw new Error("无法上传图片");
    fd.append("page_number", pageNumber);
  }
  return fd;
}

async function putAssignmentPng(classId: string, importId: string, filename: string, blob: Blob) {
  let last = "图片上传失败";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const up = await authFetch("/api/teacher/pdf", { method: "POST", body: assignmentUpload(importId, filename, blob) });
      const uj = await up.json().catch(() => ({}));
      if (up.ok && uj.image_url) {
        await assertStoredImage(uj.image_url as string);
        return uj.image_url as string;
      }
      last = uj.error ?? last;
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  if (!classId) throw new Error(last);
  const path = `assignments/${classId}/${importId}/${filename}`;
  const { error } = await supabase.storage.from("question-images").upload(path, blob, {
    contentType: blob.type || "image/png",
    upsert: true,
  });
  if (error) throw new Error(last);
  const url = supabase.storage.from("question-images").getPublicUrl(path).data.publicUrl;
  await assertStoredImage(url);
  return url;
}

const TEST_ROSTER = [
  { student_id: "TEST01", student_name: "测试学生一" },
  { student_id: "TEST02", student_name: "测试学生二" },
  { student_id: "TEST03", student_name: "测试学生三" },
];

async function pageToJpeg(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1400 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法压缩页图");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("页图压缩失败"))), "image/jpeg", 0.72);
  });
  return jpeg;
}

type TeacherPage = "overview" | "roster" | "exam" | "scores" | "pdf";

function readTeacherSearch(search: Record<string, unknown>): { page?: TeacherPage; exam?: string } {
  const pages: TeacherPage[] = ["roster", "exam", "scores", "pdf"];
  const page = pages.find((item) => item === search.page);
  const exam = typeof search.exam === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search.exam)
    ? search.exam
    : undefined;
  return { ...(page ? { page } : {}), ...(exam ? { exam } : {}) };
}

export const Route = createFileRoute("/teacher")({
  head: () => ({ meta: [{ title: "教师端 · 学校考试" }, { name: "robots", content: "noindex" }] }),
  validateSearch: readTeacherSearch,
  component: TeacherHome,
});

type RosterRow = { id: string; student_id: string; student_name: string; user_id: string | null; account_name?: string | null; id_locked?: boolean };
type Paper = {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  created_at?: string | null;
  total_seconds?: number | null;
  frq_seconds?: number | null;
  break_seconds?: number | null;
};
type Assignment = {
  id: string;
  title: string;
  exam_code: string;
  starts_at: string;
  ends_at: string;
  results_published: boolean;
  paper_id: string;
  paper: { id: string; slug: string; title: string } | null;
  class_name?: string;
  teacher_name?: string;
  mcq_seconds?: number | null;
  frq_seconds?: number | null;
  break_seconds?: number | null;
  score_max?: number | null;
  roster_count?: number;
  submitted_count?: number;
  mcq_correct?: number;
  mcq_total?: number;
  pending_frq?: number;
  ap?: ApClassSummary;
};
type GradeFrq = {
  frq_id: string;
  title: string | null;
  sort_order: number;
  max_score: number;
  answer_text: string;
  file_url: string | null;
  ai_score: number | null;
  ai_failed?: boolean;
  ai_error?: string | null;
  ai_tries?: number;
  needs_review?: boolean;
  ai_comment: string | null;
  ai_suggestions: string | null;
  breakdown: { point: string; awarded: boolean; comment: string; points?: number; earned?: number }[];
  parts?: { key: string; label: string; max: number; max_known: boolean; ai_earned: number | null; manual_earned: number | null; points: { point: string; awarded: boolean; comment: string; points?: number; earned?: number }[] }[];
  manual_score: number | null;
  manual_comment: string | null;
};
type GradeMcq = { n: number; picked: string | null; is_correct: boolean | null };
type GradeRow = {
  roster_id: string;
  student_id: string;
  student_name: string;
  account_name?: string | null;
  status: string;
  submitted_at: string | null;
  mcq_correct: number | null;
  mcq_total: number | null;
  mcq_closed?: boolean;
  frq_answers: Record<string, { text?: string; fileUrl?: string | null }>;
  mcqs: GradeMcq[];
  frqs: GradeFrq[];
  frq_score: number | null;
  frq_max: number;
  collected_reason?: "deadline" | null;
};
type PdfImport = { id: string; filename: string; page_count: number; status: string; paper_id: string | null; created_at: string; item_count?: number };
type PdfPage = { id: string; page_number: number; image_url: string; extracted_text: string | null };
type PdfItem = TeacherPdfItem;

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/\r?\n+/g, " ").replace(/"/g, '""')}"`;
}

function columnNumbers<T>(rows: GradeRow[], pick: (row: GradeRow) => T[] | null | undefined, numberOf: (item: T) => number) {
  const seen = new Set<number>();
  for (const row of rows) {
    for (const item of pick(row) ?? []) seen.add(numberOf(item));
  }
  return [...seen].sort((a, b) => a - b);
}

function mcqHandedIn(row: GradeRow) {
  if (row.status === "submitted" || row.mcq_closed) return true;
  return (row.frqs ?? []).some((frq) => frq.answer_text.trim() || frq.file_url);
}

function mcqProgressLabel(row: GradeRow) {
  if (!mcqHandedIn(row)) return row.status === "in_progress" ? "作答中" : "—";
  if (row.mcq_correct != null && row.mcq_total) return `已交 ${row.mcq_correct}/${row.mcq_total}`;
  const answered = (row.mcqs ?? []).filter((item) => item.picked).length;
  const total = row.mcq_total || row.mcqs?.length || 0;
  return total ? `已交 ${answered}/${total}` : "已交";
}

const GRADE_TRY_LIMIT = 4;

function ungradedAnswerCount(row: GradeRow) {
  return (row.frqs ?? []).filter((frq) => !isBlankStudentAnswer(frq.answer_text, frq.file_url) && frq.manual_score == null && frq.ai_score == null).length;
}

function frqStillRetrying(frq: GradeFrq) {
  if (frq.manual_score != null || frq.ai_score != null) return false;
  if (isBlankStudentAnswer(frq.answer_text, frq.file_url)) return false;
  if (!frq.ai_failed) return true;
  return (frq.ai_tries ?? 1) < GRADE_TRY_LIMIT;
}

function autoCollected(row: GradeRow, endsAt?: string | null) {
  if (row.status !== "submitted") return false;
  if (row.collected_reason === "deadline") return true;
  if (!endsAt || !row.submitted_at) return false;
  const submitted = Date.parse(row.submitted_at);
  const ends = Date.parse(endsAt);
  return Number.isFinite(submitted) && Number.isFinite(ends) && submitted >= ends;
}

function examHasEnded(endsAt?: string | null) {
  if (!endsAt) return false;
  const ends = Date.parse(endsAt);
  return Number.isFinite(ends) && Date.now() >= ends;
}

function rowStatusLabel(row: GradeRow, endsAt?: string | null) {
  if (row.status === "submitted") return autoCollected(row, endsAt) ? "截止后自动收卷" : "已交";
  if (row.status === "missing") return examHasEnded(endsAt) ? "未参加" : "未入场";
  if (row.status !== "in_progress") return "未交";
  return mcqHandedIn(row) ? "选择题已交" : "作答中";
}

function frqHeaderLabel(row: GradeRow) {
  const frqs = row.frqs ?? [];
  const scored = frqs.filter((frq) => frq.manual_score != null || frq.ai_score != null);
  const left = frqs.filter((frq) => !isBlankStudentAnswer(frq.answer_text, frq.file_url) && frq.manual_score == null && frq.ai_score == null).length;
  const earned = scored.reduce((sum, frq) => sum + (frq.manual_score ?? frq.ai_score ?? 0), 0);
  if (scored.length > 0 && left > 0) return ` · 大题已出 ${earned} 分，还有 ${left} 题没批完`;
  if (left > 0) return ` · 大题还有 ${left} 题没批完`;
  if (scored.length === 0) return " · 大题还没有分数";
  return ` · 大题 ${row.frq_score ?? earned}/${row.frq_max}`;
}

function liveRetryNote(note: string, retryAt: number, now: number) {
  if (!retryAt || retryAt <= now) return note;
  const left = Math.max(1, Math.ceil((retryAt - now) / 1000));
  const label = left >= 60 ? `${Math.floor(left / 60)} 分 ${String(left % 60).padStart(2, "0")} 秒` : `${left} 秒`;
  const live = `（${label}后自动再试）`;
  if (/（约 .+后）/.test(note)) return note.replace(/（约 .+后）/, live);
  return note ? `${note}${live}` : `${label}后自动再试`;
}

type GradeCache = {
  meta: { title: string; results_published: boolean; ends_at: string; ai_grade: boolean; score_max: number | null };
  rows: GradeRow[];
};

function gradePauseKey(id: string) {
  return `easyecon-grade-pause:${id}`;
}

function gradeCacheKey(id: string) {
  return `easyecon-gradebook:${id}`;
}

function lastGradeId() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem("easyecon-gradebook-last") ?? "";
}

function readGradeCache(id: string): GradeCache | null {
  if (!id || typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(gradeCacheKey(id)) ?? "") as GradeCache;
    if (!parsed?.meta || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeGradeCache(id: string, cache: GradeCache) {
  if (!id || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem("easyecon-gradebook-last", id);
    sessionStorage.setItem(gradeCacheKey(id), JSON.stringify(cache));
  } catch {
    /* 成绩册太大时忽略缓存，刷新会再读一次 */
  }
}

function readAssignmentCache(): Assignment[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem("easyecon-teacher-assignments") ?? "");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAssignmentCache(rows: Assignment[]) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem("easyecon-teacher-assignments", JSON.stringify(rows));
  } catch {
    /* 名单太大时忽略，刷新会再读一次 */
  }
}

function examInputMs(value: string) {
  return Date.parse(beijingInputToIso(value));
}

function parseRosterCsv(text: string): { student_id: string; student_name: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const start = /学号|student/i.test(lines[0]) ? 1 : 0;
  const rows: { student_id: string; student_name: string }[] = [];
  for (const line of lines.slice(start)) {
    const parts = line.split(/[,，\t]/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    rows.push({ student_id: parts[0], student_name: parts[1] });
  }
  return rows;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "ok" | "warn" | "muted" | "live" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "ok" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-800",
        tone === "warn" && "border-amber-500/25 bg-amber-500/10 text-amber-800",
        tone === "muted" && "border-transparent bg-muted text-muted-foreground",
        tone === "live" && "border-primary/20 bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  );
}

function examWindow(startsAt: string, endsAt: string) {
  const now = Date.now();
  if (now < new Date(startsAt).getTime()) return { label: "未开始", tone: "muted" as const };
  if (now > new Date(endsAt).getTime()) return { label: "已结束", tone: "warn" as const };
  return { label: "进行中", tone: "live" as const };
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Users; title: string; hint: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <Icon className="mx-auto mb-3 h-7 w-7 text-primary/50" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  icon?: typeof Users;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon ? (
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

const PAGE_COPY: Record<TeacherPage, [string, string, string]> = {
  overview: ["工作台", "欢迎使用教师工作台", "先导入学生名册，再创建第一场考试。"],
  roster: ["学生名册", "学生名册", "导入一次即可复用，新增学生不会覆盖已有记录。"],
  exam: ["布置考试", "布置一场考试", "设置考试信息，确认后即可生成学生考试码。"],
  scores: ["成绩分析", "成绩分析", "考试发布并收到学生答卷后，成绩会显示在这里。"],
  pdf: ["PDF 出题", "PDF 智能出题", "上传试卷 PDF，整理题目后提交到后台，再布置考试。"],
};

const NAV: { id: TeacherPage; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "工作台", icon: LayoutDashboard },
  { id: "roster", label: "学生名册", icon: Users },
  { id: "exam", label: "布置考试", icon: ClipboardList },
  { id: "scores", label: "成绩分析", icon: BarChart3 },
  { id: "pdf", label: "PDF 出题", icon: FileUp },
];

function paperSectionMinutes(paper: Pick<Paper, "slug" | "total_seconds" | "frq_seconds" | "break_seconds">) {
  const clock = ap2025Clock(paper.slug, {
    total_seconds: paper.total_seconds || MCQ_MINUTES_DEFAULT * 60,
    frq_seconds: paper.frq_seconds,
    break_seconds: paper.break_seconds,
  });
  const storedMcq = Math.round(clock.total_seconds / 60);
  const mcq = Math.min(180, Math.max(1, storedMcq > 90 ? MCQ_MINUTES_DEFAULT : storedMcq));
  const rawFrq = Math.round((clock.frq_seconds ?? FRQ_MINUTES_DEFAULT * 60) / 60);
  const frq = rawFrq <= 0 ? 0 : Math.max(10, Math.min(180, rawFrq));
  const breakMinutes = frq > 0 ? Math.min(20, Math.max(0, Math.round((clock.break_seconds ?? BREAK_MINUTES_DEFAULT * 60) / 60))) : 0;
  return { mcq: Math.min(180, mcq), frq, breakMinutes };
}

function assignmentTiming(exam: Pick<Assignment, "mcq_seconds" | "frq_seconds" | "break_seconds" | "starts_at" | "ends_at">) {
  return sectionTimingLabel(exam.mcq_seconds, exam.frq_seconds, exam.break_seconds)
    ?? `开考到截止 ${Math.max(1, Math.round((Date.parse(exam.ends_at) - Date.parse(exam.starts_at)) / 60000))} 分钟`;
}

function gradeAp(row: GradeRow) {
  if (row.status !== "submitted") {
    return apMicroScore({ mcqCorrect: null, mcqTotal: null, frqEarned: null, frqMax: null });
  }
  const hasFrq = row.frq_max > 0;
  const frqOpen = ungradedAnswerCount(row) > 0;
  return apMicroScore({
    mcqCorrect: row.mcq_correct,
    mcqTotal: row.mcq_total,
    frqEarned: hasFrq && !frqOpen ? row.frq_score : null,
    frqMax: hasFrq ? row.frq_max : null,
  });
}

function scaledLabel(result: ApScore, scoreMax: number | null | undefined) {
  if (!scoreMax) return "—";
  const points = pointsOnScale(result.composite, scoreMax);
  if (points == null) return result.reason === "frq-pending" || result.reason === "mcq-pending" ? "待出分" : "—";
  return `${points}/${scoreMax}`;
}

function formatApAverage(summary: ApClassSummary | null | undefined) {
  if (!summary || summary.average == null) return summary?.pending ? "待出分" : "—";
  return summary.average.toFixed(1);
}

function mcqRate(rows: GradeRow[]) {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    if (row.mcq_correct == null || !row.mcq_total) continue;
    correct += row.mcq_correct;
    total += row.mcq_total;
  }
  if (!total) return null;
  return Math.round((correct / total) * 100);
}

function isPageShot(url: string | null | undefined) {
  return !!url && /\/page-\d+\.(png|jpe?g|webp)(?:$|\?)/i.test(url);
}

function missingImageFinding(reason: string) {
  return /has_image\s*=\s*false|缺图|缺少图表|没有配图|没有图表|未附图表|没有截图|需要补图/i.test(reason);
}

async function cropAlreadyStored(url: string) {
  const res = await fetch(mediaSrcRetry(url, 0), { cache: "no-store" });
  await res.body?.cancel();
  return res.ok;
}

function pointLabel(point: { awarded: boolean; comment: string; points?: number; earned?: number; point: string }) {
  const score = typeof point.earned === "number" && typeof point.points === "number"
    ? `得 ${point.earned}/${point.points}`
    : point.comment === "还没有逐条分数"
      ? (typeof point.points === "number" ? `这条满分 ${point.points}，还没有逐条分数` : "还没有逐条分数")
      : point.awarded ? "得分" : "未得分";
  return `${score} · ${point.point}${point.comment && point.comment !== "还没有逐条分数" ? `：${point.comment}` : ""}`;
}

function frqClassNotes(rows: GradeRow[]) {
  const byQuestion = new Map<number, { scores: number[]; max: number; points: Map<string, { miss: number; seen: number }> }>();
  for (const row of rows) {
    if (row.status !== "submitted") continue;
    for (const frq of row.frqs ?? []) {
      const score = frq.manual_score ?? frq.ai_score;
      if (score == null) continue;
      const bucket = byQuestion.get(frq.sort_order) ?? { scores: [] as number[], max: frq.max_score, points: new Map<string, { miss: number; seen: number }>() };
      bucket.scores.push(score);
      bucket.max = frq.max_score;
      for (const point of frq.breakdown ?? []) {
        if (!point.point || point.comment === "还没有逐条分数") continue;
        const key = point.point;
        const cur = bucket.points.get(key) ?? { miss: 0, seen: 0 };
        cur.seen += 1;
        const missed = typeof point.earned === "number" && typeof point.points === "number" ? point.earned < point.points : !point.awarded;
        if (missed) cur.miss += 1;
        bucket.points.set(key, cur);
      }
      byQuestion.set(frq.sort_order, bucket);
    }
  }
  return [...byQuestion.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, bucket]) => {
      const avg = bucket.scores.reduce((sum, score) => sum + score, 0) / bucket.scores.length;
      const worst = [...bucket.points.entries()].sort((a, b) => b[1].miss - a[1].miss || b[1].seen - a[1].seen)[0];
      return {
        n,
        avg,
        max: bucket.max,
        count: bucket.scores.length,
        worst: worst && worst[1].miss > 0 ? { point: worst[0], miss: worst[1].miss, seen: worst[1].seen } : null,
      };
    });
}

function sortPdfItems(items: PdfItem[]) {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "mcq" ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

function paperPickerLabel(p: Paper) {
  const timing = paperSectionMinutes(p);
  const time = sectionTimingLabel(timing.mcq * 60, timing.frq * 60, timing.breakMinutes * 60);
  const name = p.slug.startsWith("school-")
    ? `${p.title} · 本校导入${p.created_at ? ` ${new Date(p.created_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}` : ""}`
    : p.year ? `${p.title} · ${p.year}` : p.title;
  return time ? `${name} · ${time}` : name;
}

function importStatusLabel(imp: PdfImport) {
  if (typeof imp.item_count === "number" && imp.item_count === 0 && (imp.status === "published" || imp.status === "reviewing")) return "识别失败";
  if (imp.status === "published") return "已交给管理员";
  if (imp.status === "reviewing") return "待确认";
  if (imp.status === "rendered") return "未提交";
  return "处理中";
}

function importChipLabel(imp: PdfImport) {
  const when = imp.created_at
    ? new Date(imp.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const count = typeof imp.item_count === "number" ? ` · ${imp.item_count} 题` : "";
  return `${imp.filename.replace(/\.pdf$/i, "")} · ${importStatusLabel(imp)}${count}${when ? ` · ${when}` : ""} · ${imp.id.slice(0, 4)}`;
}

function emptyItem(page: number, order: number, kind: "mcq" | "frq"): PdfItem {
  return {
    kind,
    sort_order: order,
    page_number: page,
    stem: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    option_e: "",
    correct_answer: "",
    content: "",
    max_score: kind === "mcq" ? 1 : 0,
    reviewed: false,
    rubric_note: "",
  };
}

function frqScorePrompt(it: { kind: string; sort_order: number; max_score: number }, ack: number | undefined) {
  if (it.kind !== "frq") return null;
  if (!(it.max_score >= 1)) return `Q${it.sort_order} 没有认出卷面分值，请填写满分。`;
  if (it.max_score === 1 && ack !== 1) return `Q${it.sort_order} 满分只有 1 分，请确认。`;
  return null;
}

function TeacherHome() {
  const { user, loading: authLoading, signOut } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const accountLabel = useAccountLabel("教师");
  const [denied, setDenied] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [replaceRosterOpen, setReplaceRosterOpen] = useState(false);
  const [collectTarget, setCollectTarget] = useState<GradeRow | null>(null);
  const [csvText, setCsvText] = useState("学号,姓名\n");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [examsLoaded, setExamsLoaded] = useState(false);
  const [rosterDup, setRosterDup] = useState<null | { rows: { student_id: string; student_name: string }[]; replace: boolean; duplicates: string[] }>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"existing" | "random">("existing");
  const [paperId, setPaperId] = useState("");
  const [startsAt, setStartsAt] = useState(() => toBeijingInput(new Date()));
  const [mcqMinutes, setMcqMinutes] = useState(MCQ_MINUTES_DEFAULT);
  const [frqMinutes, setFrqMinutes] = useState(FRQ_MINUTES_DEFAULT);
  const [breakMinutes, setBreakMinutes] = useState(BREAK_MINUTES_DEFAULT);
  const [scoreMax, setScoreMax] = useState(CUSTOM_SCORE_MAX_DEFAULT);
  const [publishAnswers, setPublishAnswers] = useState(false);
  const [aiGradeFrq, setAiGradeFrq] = useState(true);
  const [cropPick, setCropPick] = useState<{ index: number; pageUrl: string } | null>(null);
  const [endsAt, setEndsAt] = useState(() => toBeijingInput(new Date(Date.now() + sectionTotalMinutes(MCQ_MINUTES_DEFAULT, FRQ_MINUTES_DEFAULT, BREAK_MINUTES_DEFAULT) * 60 * 1000)));
  const [creating, setCreating] = useState(false);
  const [gradeId, setGradeId] = useState(() => search.exam || lastGradeId());
  const [gradeRows, setGradeRows] = useState<GradeRow[]>(() => readGradeCache(search.exam || lastGradeId())?.rows ?? []);
  const [gradeFocusId, setGradeFocusId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, string>>({});
  const [partDraft, setPartDraft] = useState<Record<string, string>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [gradeBusy, setGradeBusy] = useState<"save" | "ai" | "collect" | "end" | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [gradeMeta, setGradeMeta] = useState<GradeCache["meta"] | null>(() => readGradeCache(search.exam || lastGradeId())?.meta ?? null);
  const [gradeNote, setGradeNote] = useState("");
  const gradingLock = useRef(false);
  const autoQueued = useRef("");
  const gradeTicket = useRef(0);
  const gradeNotice = useRef("");
  const gradePause = useRef(false);
  const gradeHold = useRef(0);
  const [gradeRetryAt, setGradeRetryAt] = useState(0);
  const [gradeClock, setGradeClock] = useState(0);
  const [gradePaused, setGradePaused] = useState(false);
  const [imports, setImports] = useState<PdfImport[]>([]);
  const [activeImport, setActiveImport] = useState<string>("");
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [items, setItems] = useState<PdfItem[]>([]);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfBusy, setPdfBusy] = useState("");
  const [pdfNotice, setPdfNotice] = useState("");
  const [scoreAck, setScoreAck] = useState<Record<string, number>>({});
  const [pdfClassId, setPdfClassId] = useState("");
  const pageBlobs = useRef(new Map<number, Blob>());
  const [pdfFindings, setPdfFindings] = useState<PdfAiFinding[]>([]);
  const [pdfAiRan, setPdfAiRan] = useState(false);
  const [pdfAiDone, setPdfAiDone] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const page: TeacherPage = search.page ?? "overview";
  const [examStep, setExamStep] = useState<"edit" | "review" | "done">("edit");
  const [publishedExam, setPublishedExam] = useState<{ title: string; code: string } | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [scoreQuery, setScoreQuery] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const [studentEditor, setStudentEditor] = useState<null | { id: string | null; student_id: string; student_name: string }>(null);
  const [studentEditorError, setStudentEditorError] = useState("");
  const [savingStudent, setSavingStudent] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simStage, setSimStage] = useState<"login" | "exam" | "done">("login");
  const [simStudentId, setSimStudentId] = useState("");
  const [simExamCode, setSimExamCode] = useState("");
  const [simSeconds, setSimSeconds] = useState(60 * 60);
  const [minecraft, setMinecraft] = useState(false);

  const loadClass = useCallback(async () => {
    const r = await authFetch("/api/teacher/class");
    if (r.status === 401 || r.status === 503) {
      const j = await r.json().catch(() => ({}));
      if (j.error === "session_expired") {
        await supabase.auth.signOut();
        return;
      }
      if (j.error === "unavailable") {
        setDenied(false);
        setCheckFailed(true);
        return;
      }
      setCheckFailed(false);
      setDenied(true);
      return;
    }
    const j = await r.json();
    setRoster(j.roster ?? []);
    setDenied(false);
    setCheckFailed(false);
    setReady(true);
  }, []);

  const loadAssignments = useCallback(async () => {
    const [a, p] = await Promise.all([
      authFetch("/api/teacher/assignments"),
      authFetch("/api/teacher/assignments?papers=1"),
    ]);
    if (a.ok) {
      const rows = ((await a.json()).assignments ?? []) as Assignment[];
      setAssignments(rows);
      writeAssignmentCache(rows);
    }
    setExamsLoaded(true);
    if (p.ok) setPapers((await p.json()).papers ?? []);
  }, []);

  const loadPdfs = useCallback(async () => {
    const r = await authFetch("/api/teacher/pdf");
    if (r.ok) setImports((await r.json()).imports ?? []);
  }, []);

  useLayoutEffect(() => {
    const cached = readAssignmentCache();
    if (cached.length === 0) return;
    setAssignments((current) => (current.length > 0 ? current : cached));
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadClass().then(() => Promise.all([loadAssignments(), loadPdfs()]));
  }, [authLoading, user, loadClass, loadAssignments, loadPdfs]);

  useEffect(() => {
    const dueSoon = assignments.some((item) => {
      const ends = Date.parse(item.ends_at);
      return Number.isFinite(ends) && ends > Date.now() - 3 * 60 * 60 * 1000;
    });
    if (!dueSoon) return;
    const timer = window.setInterval(() => { void loadAssignments(); }, 15000);
    return () => window.clearInterval(timer);
  }, [assignments, loadAssignments]);

  useEffect(() => {
    try {
      setMinecraft(localStorage.getItem("easyecon-teacher-theme") === "minecraft");
    } catch {
      setMinecraft(false);
    }
  }, []);

  useEffect(() => {
    if (!minecraft) {
      delete document.body.dataset.theme;
      return;
    }
    document.body.dataset.theme = "minecraft";
    return () => {
      delete document.body.dataset.theme;
    };
  }, [minecraft]);

  function toggleMinecraft() {
    setMinecraft((on) => {
      const next = !on;
      try {
        localStorage.setItem("easyecon-teacher-theme", next ? "minecraft" : "default");
      } catch {
        /* 皮肤选择存不下时，这一次刷新前仍然生效 */
      }
      return next;
    });
  }

  useEffect(() => {
    if (!simOpen || simStage !== "exam") return;
    const timer = window.setInterval(() => {
      setSimSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [simOpen, simStage]);

  async function importRoster(replace: boolean, onDuplicate?: "skip" | "update", rows = parseRosterCsv(csvText)) {
    if (rows.length === 0) {
      toast.error("没有读到学号/姓名");
      return;
    }
    if (replace && assignments.some((item) => Date.parse(item.ends_at) > Date.now())) {
      toast.error("有考试还没结束，不能覆盖名册");
      return;
    }
    const r = await authFetch("/api/teacher/class", {
      method: "POST",
      body: JSON.stringify({ rows, replace, on_duplicate: onDuplicate }),
    });
    const j = await r.json();
    if (r.status === 409 && Array.isArray(j.duplicates)) {
      setRosterDup({ rows, replace, duplicates: j.duplicates as string[] });
      return;
    }
    if (!r.ok) {
      toast.error(j.error ?? "导入失败");
      return;
    }
    setRoster(j.roster ?? []);
    setReplaceRosterOpen(false);
    setRosterDup(null);
    const added = typeof j.added === "number" ? j.added : j.roster?.length ?? 0;
    const skipped = typeof j.skipped === "number" ? j.skipped : 0;
    const updated = typeof j.updated === "number" ? j.updated : 0;
    toast.success(`新增 ${added} 人${skipped ? `，跳过 ${skipped} 个重复学号` : ""}${updated ? `，更新 ${updated} 个姓名` : ""}`);
  }

  async function importTestRoster() {
    if (!window.confirm("将添加 TEST01、TEST02、TEST03 三名测试学生。确定添加？")) return;
    const r = await authFetch("/api/teacher/class", {
      method: "POST",
      body: JSON.stringify({ rows: TEST_ROSTER, replace: false, on_duplicate: "skip" }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "测试学号导入失败");
      return;
    }
    setRoster(j.roster ?? []);
    toast.success("已导入 TEST01、TEST02、TEST03。入场时姓名分别填「测试学生一」「测试学生二」「测试学生三」。");
  }

  function openStudentEditor(row?: RosterRow) {
    setStudentEditorError("");
    setStudentEditor(
      row
        ? { id: row.id, student_id: row.student_id, student_name: row.student_name }
        : { id: null, student_id: "", student_name: "" },
    );
  }

  async function saveStudent() {
    if (!studentEditor) return;
    const student_id = studentEditor.student_id.trim();
    const student_name = studentEditor.student_name.trim();
    if (!student_id || !student_name) {
      setStudentEditorError("学号和姓名都需要填写。");
      return;
    }
    setSavingStudent(true);
    setStudentEditorError("");
    try {
      const r = await authFetch("/api/teacher/class", {
        method: studentEditor.id ? "PATCH" : "POST",
        body: JSON.stringify(
          studentEditor.id
            ? { id: studentEditor.id, student_id, student_name }
            : { rows: [{ student_id, student_name }] },
        ),
      });
      const j = await r.json();
      if (r.status === 409) {
        setStudentEditorError("这个学号已在名册中。要改姓名，请打开原来那一行，这里不会自动改掉。");
        return;
      }
      if (!r.ok) {
        setStudentEditorError(j.error ?? "保存失败");
        return;
      }
      setRoster(j.roster ?? []);
      setStudentEditor(null);
      toast.success(studentEditor.id ? "学生信息已更新" : "已添加学生");
    } finally {
      setSavingStudent(false);
    }
  }

  async function deleteStudent(row: RosterRow) {
    if (!window.confirm(`确定删除学生「${row.student_name}」（学号 ${row.student_id}）吗？`)) return;
    const r = await authFetch("/api/teacher/class", {
      method: "DELETE",
      body: JSON.stringify({ id: row.id }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "删除失败");
      return;
    }
    setRoster(j.roster ?? []);
    toast.success("已从名册移除");
  }

  function openStudentSimulation() {
    const latest = publishedExam ?? (assignments[0] ? { title: assignments[0].title, code: assignments[0].exam_code } : null);
    setSimStudentId(roster[0]?.student_id ?? "");
    setSimExamCode(latest?.code ?? "");
    setSimStage("login");
    setSimSeconds(60 * 60);
    setSimOpen(true);
  }

  function closeStudentSimulation() {
    setSimOpen(false);
    setSimStage("login");
  }

  async function createAssignment() {
    setCreating(true);
    try {
      const r = await authFetch("/api/teacher/assignments", {
        method: "POST",
        body: JSON.stringify({
          title,
          source,
          paper_id: source === "existing" ? paperId : undefined,
          starts_at: beijingInputToIso(startsAt),
          ends_at: beijingInputToIso(endsAt),
          mcq_minutes: mcqMinutes,
          frq_minutes: frqMinutes,
          break_minutes: frqMinutes > 0 ? breakMinutes : 0,
          score_max: scoreMax,
          publish_answers: publishAnswers,
          ai_grade: aiGradeFrq,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "布置失败");
        return;
      }
      if (aiGradeFrq && j.ai_grade_saved === false) {
        toast.message("答案开关已保存。这份卷没能记下 AI 批改，截止后不会自动批大题。");
      }
      toast.success(`考试码 ${j.assignment.exam_code} 已复制`);
      setPublishedExam({ title, code: j.assignment.exam_code });
      setTitle("");
      setExamStep("done");
      await loadAssignments();
      setGradeId(j.assignment.id);
      openTeacherPage("exam");
      try {
        await navigator.clipboard.writeText(j.assignment.exam_code);
        setCopied(j.assignment.exam_code);
      } catch {
        /* 浏览器可能拦截剪贴板，考试码仍会显示在列表里 */
      }
    } finally {
      setCreating(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      toast.success("考试码已复制");
      window.setTimeout(() => setCopied((c) => (c === code ? "" : c)), 1600);
    } catch {
      toast.error("复制失败，请手动抄写");
    }
  }

  async function loadGradebook(id: string, opts?: { keepPage?: boolean }) {
    if (!opts?.keepPage) {
      gradeTicket.current += 1;
      setGradeNote("");
    }
    const ticket = gradeTicket.current;
    setGradeId(id);
    if (!opts?.keepPage) openTeacherPage("scores", id);
    const r = await authFetch(`/api/teacher/gradebook?assignment_id=${id}`);
    const j = await r.json();
    if (gradeTicket.current !== ticket) return;
    if (!r.ok) {
      toast.error(j.error ?? "无法加载成绩册");
      return;
    }
    const rows = (j.rows ?? []) as GradeRow[];
    setGradeRows(
      rows.length > 0
        ? rows
        : roster.map((student) => ({
            roster_id: student.id,
            student_id: student.student_id,
            student_name: student.student_name,
            account_name: student.account_name ?? null,
            status: "missing",
            submitted_at: null,
            mcq_correct: null,
            mcq_total: null,
            frq_answers: {},
            mcqs: [],
            frqs: [],
            frq_score: null,
            frq_max: 0,
            collected_reason: null,
          })),
    );
    const meta = {
      title: j.assignment.title,
      results_published: j.assignment.results_published,
      ends_at: j.assignment.ends_at,
      ai_grade: j.assignment.ai_grade !== false,
      score_max: typeof j.assignment.score_max === "number" ? j.assignment.score_max : null,
    };
    setGradeMeta(meta);
    writeGradeCache(id, { meta, rows: rows.length > 0 ? rows : [] });
    return rows;
  }

  function openGrade(row: GradeRow) {
    if (row.status === "missing") {
      toast.message(examHasEnded(gradeMeta?.ends_at) ? "这名学生没有参加这场考试" : "这名学生还没入场");
      return;
    }
    setGradeFocusId(row.roster_id);
    const draft: Record<string, string> = {};
    const parts: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const frq of row.frqs ?? []) {
      draft[frq.frq_id] = frq.manual_score == null ? "" : String(frq.manual_score);
      notes[frq.frq_id] = frq.manual_comment ?? "";
      for (const part of frq.parts ?? []) {
        parts[`${frq.frq_id}:${part.key}`] = part.manual_earned == null ? "" : String(part.manual_earned);
      }
    }
    setManualDraft(draft);
    setPartDraft(parts);
    setCommentDraft(notes);
  }

  async function saveManualScores() {
    const row = gradeRows.find((r) => r.roster_id === gradeFocusId);
    if (!gradeId || !row) return;
    const manual: Record<string, number | null> = {};
    const comments: Record<string, string | null> = {};
    const parts: Record<string, Record<string, number | null>> = {};
    for (const frq of row.frqs ?? []) {
      const note = (commentDraft[frq.frq_id] ?? "").trim();
      if (note.length > 2000) {
        toast.error(`第 ${frq.sort_order} 题的评语不超过 2000 字`);
        return;
      }
      comments[frq.frq_id] = note || null;
      const pieces = frq.parts ?? [];
      if (pieces.length >= 2) {
        const hadParts = pieces.some((part) => part.manual_earned != null);
        const anyTyped = pieces.some((part) => (partDraft[`${frq.frq_id}:${part.key}`] ?? "").trim() !== "");
        if (!anyTyped && !hadParts) {
          manual[frq.frq_id] = frq.manual_score;
          continue;
        }
        const bucket: Record<string, number | null> = {};
        let sum = 0;
        let any = false;
        for (const part of pieces) {
          const raw = (partDraft[`${frq.frq_id}:${part.key}`] ?? "").trim();
          const cap = part.max_known ? Math.min(part.max, frq.max_score) : frq.max_score;
          if (!raw) {
            bucket[part.key] = null;
            sum += part.ai_earned ?? 0;
            continue;
          }
          if (!/^\d+$/.test(raw)) {
            toast.error(`第 ${frq.sort_order} 题${part.label}要填整数`);
            return;
          }
          const score = Number(raw);
          if (score > cap) {
            toast.error(`第 ${frq.sort_order} 题${part.label}的分数要在 0 到 ${cap} 之间`);
            return;
          }
          bucket[part.key] = score;
          sum += score;
          any = true;
        }
        if (any && sum > frq.max_score) {
          toast.error(`第 ${frq.sort_order} 题各小问加起来是 ${sum}，不能超过满分 ${frq.max_score}`);
          return;
        }
        parts[frq.frq_id] = bucket;
        manual[frq.frq_id] = null;
        continue;
      }
      const raw = (manualDraft[frq.frq_id] ?? "").trim();
      if (!raw) {
        manual[frq.frq_id] = null;
        continue;
      }
      const score = Number(raw);
      if (!Number.isFinite(score) || score < 0 || score > frq.max_score) {
        toast.error(`第 ${frq.sort_order} 题的分数要在 0 到 ${frq.max_score} 之间`);
        return;
      }
      manual[frq.frq_id] = Math.round(score);
    }
    setGradeBusy("save");
    try {
      const r = await authFetch("/api/teacher/gradebook", {
        method: "POST",
        body: JSON.stringify({ assignment_id: gradeId, roster_id: row.roster_id, manual, comments, parts }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "分数没能保存");
        return;
      }
      const rows = await loadGradebook(gradeId);
      const next = rows?.find((item) => item.roster_id === row.roster_id);
      if (next) openGrade(next);
      toast.success("分数和评语已保存");
    } finally {
      setGradeBusy(null);
    }
  }

  function pendingAiRows(rows: GradeRow[]) {
    return rows.filter((row) => row.status === "submitted" && (row.frqs ?? []).some((frq) => frqStillRetrying(frq)));
  }

  async function runGradeQueue(rosterIds: string[], manual: boolean) {
    if (!gradeId || rosterIds.length === 0) return;
    const ticket = gradeTicket.current;
    if (gradingLock.current && autoQueued.current === `${gradeId}:${ticket}`) return;
    autoQueued.current = `${gradeId}:${ticket}`;
    gradingLock.current = true;
    if (manual) setGradeBusy("ai");
    setGradeNote("正在逐题批改，每题写完就保存");
    let failed = false;
    let leftover = false;
    try {
      for (const rosterId of rosterIds) {
        let consecutiveErrors = 0;
        for (let step = 0; step < 24; step++) {
          if (gradeTicket.current !== ticket) return;
          let response: Response;
          try {
            response = await authFetch("/api/teacher/gradebook", {
              method: "POST",
              signal: AbortSignal.timeout(100000),
              body: JSON.stringify({ assignment_id: gradeId, roster_id: rosterId, action: "ai" }),
            });
          } catch {
            toast.error("批改请求中断了。已经批完的题目已保存，再点一次会继续。");
            failed = true;
            break;
          }
          const body = (await response.json().catch(() => null)) as { error?: string; notice?: string; retry_at?: string | null; done?: boolean; pending?: number; busy?: boolean; graded_sort?: number | null } | null;
          if (gradeTicket.current !== ticket) return;
          await loadGradebook(gradeId, { keepPage: true });
          if (!body) {
            toast.error("批改请求中断了。已经批完的题目已保存，再点一次会继续。");
            failed = true;
            break;
          }
          if (body.retry_at) {
            const at = Date.parse(body.retry_at);
            if (Number.isFinite(at)) {
              gradeHold.current = Math.max(gradeHold.current, at);
              setGradeRetryAt(gradeHold.current);
            }
          }
          if (body.busy || (body.error && /请求过多|没批完/.test(body.error))) {
            const waiting = body.notice || body.error || "";
            if (waiting) setGradeNote(waiting);
            leftover = true;
            break;
          }
          if (!response.ok || body.error) {
            const fatal = !!body.error && /尚未配置/.test(body.error);
            const limited = !!body.error && /请求过多/.test(body.error);
            if (fatal || (!limited && !response.ok)) {
              toast.error(body.error ?? "这一题没批完。已经批完的题目已保存，再点一次会继续。");
              failed = true;
              break;
            }
            leftover = true;
            setGradeNote(body.error ?? "这一题没批完。已经出分的会保留。");
            if (limited) break;
            consecutiveErrors += 1;
            if (consecutiveErrors >= GRADE_TRY_LIMIT) break;
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            continue;
          }
          consecutiveErrors = 0;
          if (body.done || body.pending === 0) break;
          if (body.notice) setGradeNote(body.notice);
          else if (typeof body.pending === "number" && body.pending > 0) setGradeNote(`第 ${body.graded_sort ?? "这"} 题已写入，还有 ${body.pending} 题没批完`);
        }
        if (failed) break;
      }
      if (gradeTicket.current === ticket) {
        if (failed || leftover) {
          setGradeNote((note) => /没批完|可重试|请求过多/.test(note) ? note : "还有题目没批完。已经出分的会保留，可以再试一次。");
        } else {
          setGradeNote("");
          toast.success("AI 批改已写入");
        }
      }
    } finally {
      if (autoQueued.current === `${gradeId}:${ticket}`) {
        gradingLock.current = false;
        setGradeBusy(null);
      }
    }
  }

  function stopAutoGrade() {
    gradeTicket.current += 1;
    gradePause.current = true;
    setGradePaused(true);
    gradingLock.current = false;
    setGradeBusy(null);
    gradeHold.current = 0;
    setGradeRetryAt(0);
    setGradeNote("");
    if (!gradeId) return;
    sessionStorage.setItem(gradePauseKey(gradeId), "1");
    void authFetch("/api/teacher/gradebook", {
      method: "POST",
      body: JSON.stringify({ assignment_id: gradeId, action: "pause" }),
    }).catch(() => undefined);
  }

  async function regradeClass() {
    if (!gradeId) return;
    gradePause.current = false;
    setGradePaused(false);
    sessionStorage.removeItem(gradePauseKey(gradeId));
    gradeNotice.current = "";
    gradeHold.current = 0;
    setGradeRetryAt(0);
    setGradeNote("正在重新批改还没出分的大题");
    const response = await authFetch("/api/teacher/gradebook", {
      method: "POST",
      body: JSON.stringify({ assignment_id: gradeId, action: "regrade" }),
    });
    const body = await response.json().catch(() => ({} as { error?: string; notice?: string; busy?: boolean; retry_at?: string | null }));
    if (!response.ok) {
      toast.error(body.error ?? "重新批改没有开始");
      return;
    }
    if (body.retry_at) {
      const at = Date.parse(body.retry_at);
      if (Number.isFinite(at)) {
        gradeHold.current = Math.max(gradeHold.current, at);
        setGradeRetryAt(gradeHold.current);
      }
    }
    await loadGradebook(gradeId, { keepPage: true });
    if (body.busy && (body.notice || body.retry_at)) {
      setGradeNote(body.notice || "还没到可重试时间。已经出分的会保留。");
      return;
    }
    toast.success("已重新开始批改还没出分的大题");
  }

  async function gradeStudentWithAi() {
    const row = gradeRows.find((r) => r.roster_id === gradeFocusId);
    if (!gradeId || !row) return;
    if (gradingLock.current && autoQueued.current === `${gradeId}:${gradeTicket.current}`) {
      toast.message("正在逐题批改，完成的分数会马上出现");
      return;
    }
    void runGradeQueue([row.roster_id], true);
  }

  const classGradeDue = !!gradeId && gradeMeta?.ai_grade !== false && !!gradeMeta && Date.parse(gradeMeta.ends_at) <= Date.now() && (gradeRows.some((row) => row.status === "in_progress") || pendingAiRows(gradeRows).length > 0);

  useEffect(() => {
    const paused = !!gradeId && sessionStorage.getItem(gradePauseKey(gradeId)) === "1";
    gradePause.current = paused;
    setGradePaused(paused);
    gradeNotice.current = "";
    if (!paused) setGradeNote("");
  }, [gradeId]);

  useEffect(() => {
    if (!gradeRetryAt || gradePaused) return;
    setGradeClock(Date.now());
    const timer = window.setInterval(() => setGradeClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [gradeRetryAt, gradePaused]);

  useEffect(() => {
    if (!classGradeDue || gradePaused || (gradeId && sessionStorage.getItem(gradePauseKey(gradeId)) === "1")) return;
    let cancelled = false;
    let timer = 0;
    const arm = (delay: number) => {
      timer = window.setTimeout(run, delay);
    };
    const run = () => {
      if (cancelled || gradePause.current) return;
      const wait = gradeHold.current - Date.now();
      if (wait > 250) {
        arm(wait);
        return;
      }
      void authFetch("/api/teacher/gradebook", {
        method: "POST",
        body: JSON.stringify({ assignment_id: gradeId, action: "batch" }),
      }).then(async (response) => {
        const body = await response.json().catch(() => ({} as { notice?: string; error?: string; retry_at?: string | null }));
        if (body.retry_at) {
          const at = Date.parse(body.retry_at);
          if (Number.isFinite(at)) {
            gradeHold.current = Math.max(gradeHold.current, at);
            setGradeRetryAt(gradeHold.current);
          }
        }
        const message = body.notice || (!response.ok ? body.error : "");
        if (!message || message === gradeNotice.current) return;
        gradeNotice.current = message;
        if (/已停止自动批改/.test(message)) {
          gradePause.current = true;
          setGradePaused(true);
          if (gradeId) sessionStorage.setItem(gradePauseKey(gradeId), "1");
          gradeHold.current = 0;
          setGradeRetryAt(0);
          setGradeNote("");
          return;
        }
        setGradeNote(message);
      }).catch(() => undefined).finally(() => {
        if (cancelled || gradePause.current) return;
        const next = gradeHold.current - Date.now();
        arm(next > 250 ? next : 8000);
        void loadGradebook(gradeId, { keepPage: true });
      });
    };
    if (gradeHold.current <= Date.now()) setGradeNote((note) => note || "考试已结束，正在逐题批改。已经出分的会保留。");
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The hold is read from a ref so the timer can wait out a rate limit without polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classGradeDue, gradeId, gradePaused]);

  async function togglePublish(published: boolean) {
    if (!gradeId) return;
    const r = await authFetch("/api/teacher/assignments", {
      method: "PATCH",
      body: JSON.stringify({ id: gradeId, results_published: published }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "更新失败");
      return;
    }
    setGradeMeta((m) => (m ? { ...m, results_published: published } : m));
    await loadAssignments();
    toast.success(published ? "已公布成绩" : "已取消公布");
  }

  function exportCsv() {
    const frqCols = columnNumbers(gradeRows, (row) => row.frqs, (frq) => frq.sort_order);
    const frqHeaders = frqCols.flatMap((n) => [`Q${n}得分`, `Q${n}作答`, `Q${n}评语`]);
    const mcqFull = gradeRows.reduce((max, row) => Math.max(max, row.mcq_total ?? row.mcqs?.length ?? 0), 0);
    const frqFull = gradeRows.reduce((max, row) => Math.max(max, row.frq_max || 0), 0);
    const totalFull = mcqFull + frqFull;
    const header = ["学号", "姓名", "状态", "AP分", "综合分", "折算得分", "满分", "选择题得分", "选择题满分", "原始总分", "原始总分满分", "选择题作答", ...frqHeaders, "交卷时间（北京时间）"];
    const lines = gradeRows.map((row) => {
      const mcqText = (row.mcqs ?? []).map((item) => `Q${item.n}${item.picked ?? "-"}`).join(" ");
      const frqByNumber = new Map((row.frqs ?? []).map((frq) => [frq.sort_order, frq]));
      const frqCells = frqCols.flatMap((n) => {
        const frq = frqByNumber.get(n);
        if (!frq) return ["", "", ""];
        const score = frq.manual_score ?? frq.ai_score;
        const comment = frq.manual_comment || frq.ai_comment || frq.ai_error || "";
        return [score == null ? "" : String(score), frq.answer_text || "", comment];
      });
      const frqSum = (row.frqs ?? []).reduce((sum, frq) => sum + (frq.manual_score ?? frq.ai_score ?? 0), 0);
      const total = row.status === "submitted" ? (row.mcq_correct ?? 0) + frqSum : "";
      const ap = gradeAp(row);
      return [
        row.student_id,
        row.student_name,
        rowStatusLabel(row, gradeMeta?.ends_at),
        ap.score ?? (ap.reason === "frq-pending" ? "待大题出分" : ""),
        ap.composite ?? "",
        pointsOnScale(ap.composite, gradeMeta?.score_max) ?? "",
        gradeMeta?.score_max ?? "",
        row.mcq_correct ?? "",
        row.mcq_total ?? "",
        total,
        totalFull || "",
        mcqText,
        ...frqCells,
        beijingTime(row.submitted_at),
      ].map(csvCell);
    });
    downloadText(`${gradeMeta?.title ?? "gradebook"}.csv`, `\uFEFF${[header.map(csvCell).join(","), ...lines.map((line) => line.join(","))].join("\n")}`);
  }

  function askCollect(rosterId: string) {
    const student = gradeRows.find((item) => item.roster_id === rosterId);
    if (!student) return;
    setCollectTarget(student);
  }

  async function collectStudent(rosterId: string) {
    if (!gradeId) return;
    setCollectTarget(null);
    setGradeBusy("collect");
    try {
      const r = await authFetch("/api/teacher/gradebook", {
        method: "POST",
        body: JSON.stringify({ assignment_id: gradeId, roster_id: rosterId, action: "collect" }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "没收成");
        return;
      }
      const rows = await loadGradebook(gradeId);
      const next = rows?.find((item) => item.roster_id === rosterId);
      if (next) openGrade(next);
      toast.success("已收卷");
    } finally {
      setGradeBusy(null);
    }
  }

  async function endExamNow() {
    if (!gradeId) return;
    setGradeBusy("end");
    try {
      const r = await authFetch("/api/teacher/gradebook", {
        method: "POST",
        body: JSON.stringify({ assignment_id: gradeId, action: "end" }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "没能结束考试");
        return;
      }
      setEndConfirm(false);
      await loadGradebook(gradeId);
      await loadAssignments();
      toast.success("考试已结束，正在作答的学生已收卷");
    } finally {
      setGradeBusy(null);
    }
  }

  async function runPdfAi(importId: string, current: PdfItem[]) {
    setAiBusy(true);
    setPdfFindings([]);
    try {
      const r = await authFetch("/api/teacher/pdf", {
        method: "POST",
        body: JSON.stringify({ action: "ai-review", import_id: importId, items: current }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "AI 审核失败，请再跑一遍后再提交");
        setPdfFindings([]);
        setPdfAiDone(false);
        return;
      }
      if (j.skipped) {
        setPdfFindings([]);
        setPdfAiRan(false);
        setPdfAiDone(true);
        toast.message("AI 未配置，切题结果可直接查看；有问题再点编辑。");
        return;
      }
      const findings = ((j.findings ?? []) as PdfAiFinding[]).filter((finding) => {
        const item = current.find((it) => `${it.kind}-${it.sort_order}` === finding.key);
        const url = (item?.image_url ?? "").trim();
        const hasFigure = !!url && !isPageShot(url);
        return !(hasFigure && missingImageFinding(finding.reason));
      });
      setPdfFindings(findings);
      setPdfAiRan(true);
      setPdfAiDone(true);
      if (findings.length === 0) {
        toast.success(current.length === 1 ? "AI 没有发现这道题有明显问题。" : "AI 没有发现明显切题问题，可以直接提交。有需要再点编辑。");
      } else if (findings.length >= current.length) {
        toast.message(current.length === 1 ? "AI 标出这道题需要看一眼。" : `AI 标出全部 ${findings.length} 道题需要看一眼。`);
      } else {
        toast.message(`AI 标出 ${findings.length} 道需要看一眼，另外 ${current.length - findings.length} 道没有被标出。`);
      }
    } catch {
      setPdfFindings([]);
      setPdfAiRan(false);
      setPdfAiDone(true);
      toast.message("AI 审核超时或失败，题目仍可直接提交。");
    } finally {
      setAiBusy(false);
    }
  }

  async function requestVisionParse(
    importId: string,
    raster: { page_number: number; blob: Blob; extracted_text: string }[],
  ): Promise<{ items: ParsedExamItem[]; error?: string }> {
    const fd = new FormData();
    fd.append("action", "vision-parse");
    fd.append("import_id", importId);
    for (const page of raster.slice(0, 8)) {
      const jpeg = await pageToJpeg(page.blob);
      fd.append("files", new File([jpeg], `page-${page.page_number}.jpg`, { type: "image/jpeg" }));
      fd.append(`text-${page.page_number}`, page.extracted_text.slice(0, 8000));
    }
    const r = await authFetch("/api/teacher/pdf", {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { items: [], error: j.error ?? "AI 看页图失败" };
    const items = (Array.isArray(j.items) ? j.items : []) as ParsedExamItem[];
    return { items, error: items.length ? "" : j.error ?? "AI 没有认出题目" };
  }

  async function onPdfFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("这不是 PDF。请换成 PDF 再上传，文件没有开始处理。");
      return;
    }
    setPdfBusy("正在把每一页渲染成图片…");
    setPdfNotice("");
    setPdfAiDone(false);
    setPdfAiRan(false);
    setPdfFindings([]);
    try {
      const { rasterizePdf } = await import("@/lib/pdf-rasterize");
      const raster = await rasterizePdf(file, (d, t) => setPdfBusy(`渲染页图 ${d}/${t}`));
      setPdfBusy("创建导入记录…");
      const created = await authFetch("/api/teacher/pdf", {
        method: "POST",
        body: JSON.stringify({ action: "create", filename: file.name, page_count: raster.length }),
      });
      const cj = await created.json();
      if (!created.ok) throw new Error(cj.error ?? "创建失败");
      const importId = cj.import.id as string;
      const classId = String(cj.import.class_id ?? "");
      setPdfClassId(classId);
      pageBlobs.current = new Map(raster.map((page) => [page.page_number, page.blob]));
      const storageNotes: string[] = [];
      for (const page of raster) {
        setPdfBusy(`上传第 ${page.page_number} 页…`);
        if (!classId) {
          storageNotes.push(`第 ${page.page_number} 页没有班级，页图没法保存`);
          continue;
        }
        try {
          const imageUrl = await putAssignmentPng(classId, importId, `page-${page.page_number}.png`, page.blob);
          const rec = await authFetch("/api/teacher/pdf", {
            method: "POST",
            body: JSON.stringify({
              action: "record-page",
              import_id: importId,
              page_number: page.page_number,
              image_url: imageUrl,
              extracted_text: page.extracted_text,
            }),
          });
          if (!rec.ok) {
            const rj = await rec.json().catch(() => ({}));
            storageNotes.push(`第 ${page.page_number} 页记录失败：${rj.error ?? "未知错误"}`);
          }
        } catch (e) {
          storageNotes.push(`第 ${page.page_number} 页：${e instanceof Error ? e.message : "上传失败"}`);
        }
      }
      const opened = await openImport(importId, { quietEmpty: true });
      let parsed = applyKnownApAnswerKey(
        parseApExamPages(
          raster.map((page) => ({ page_number: page.page_number, extracted_text: page.extracted_text })),
        ),
        file.name,
      );
      let visionError = "";
      const missingChoiceE = parsed.some((item) => item.kind === "mcq" && !item.option_e.trim());
      if (parsed.length === 0 || missingChoiceE) {
        setPdfBusy(parsed.length === 0 ? "文字对不上官方试卷格式，正在让 AI 看页图…" : "有选择题缺了 E，正在对照页图补上…");
        const vision = await requestVisionParse(importId, raster);
        const seen = applyKnownApAnswerKey(vision.items, file.name);
        parsed = parsed.length === 0 ? seen : fillOptionEFrom(parsed, seen);
        visionError = vision.error ?? "";
      }
      if (parsed.length > 0) {
        const rects = cropRectsForQuestions(raster, parsed);
        const imageByKey: Record<string, string> = {};
        let cropFails = 0;
        let figures = 0;
        for (const it of parsed) {
          if (!it.needs_image) continue;
          const key = `${it.kind}-${it.sort_order}`;
          const plan = rects.get(key);
          const page = raster.find((p) => p.page_number === (plan?.page_number ?? it.page_number));
          if (!plan || !page) {
            cropFails++;
            continue;
          }
          setPdfBusy(`从整页截取第 ${it.sort_order} 题图表…`);
          try {
            let crop: Blob;
            try {
              crop = await cropImageBlob(page.blob, { ...plan, mode: "figure" });
            } catch {
              const band = plan.slices[0];
              if (!band) throw new Error("没有图表范围");
              crop = await cropImageBlob(page.blob, {
                page_number: plan.page_number,
                mode: "figure",
                hinted: true,
                slices: [{ x: Math.max(0, band.x - 36), y: 0, w: band.w + 72, h: 20000, prefer: "largest" }],
              });
            }
            figures++;
            imageByKey[key] = URL.createObjectURL(crop);
            if (classId) {
              try {
                imageByKey[key] = await putAssignmentPng(classId, importId, `${it.kind}-${it.sort_order}.png`, crop);
              } catch {
                const fd = new FormData();
                fd.append("file", new File([crop], `${it.kind}-${it.sort_order}.png`, { type: "image/png" }));
                fd.append("import_id", importId);
                fd.append("crop_kind", it.kind);
                fd.append("sort_order", String(it.sort_order));
                const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
                const uj = await up.json().catch(() => ({}));
                if (up.ok && uj.image_url) imageByKey[key] = uj.image_url;
              }
            } else {
              const fd = new FormData();
              fd.append("file", new File([crop], `${it.kind}-${it.sort_order}.png`, { type: "image/png" }));
              fd.append("import_id", importId);
              fd.append("crop_kind", it.kind);
              fd.append("sort_order", String(it.sort_order));
              const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
              const uj = await up.json().catch(() => ({}));
              if (up.ok && uj.image_url) imageByKey[key] = uj.image_url;
              else cropFails++;
            }
          } catch {
            cropFails++;
          }
        }
        const nextItems: PdfItem[] = parsed.map((it) => {
          const pageUrl = opened?.pages.find((p) => p.page_number === it.page_number)?.image_url ?? null;
          const crop = imageByKey[`${it.kind}-${it.sort_order}`] ?? null;
          const pageText = raster.find((p) => p.page_number === it.page_number)?.extracted_text ?? "";
          const visible = it.kind === "frq" ? studentVisibleQuestion(it.content, pageText) || studentVisibleQuestion(it.stem, pageText) : it.content;
          return {
            kind: it.kind,
            sort_order: it.sort_order,
            page_number: it.page_number,
            stem: it.kind === "frq" ? readableFrqLabel(studentVisibleQuestion(it.stem, pageText) || it.stem, visible, it.sort_order) : it.stem,
            option_a: it.option_a,
            option_b: it.option_b,
            option_c: it.option_c,
            option_d: it.option_d,
            option_e: it.option_e,
            correct_answer: it.correct_answer || "",
            content: visible,
            max_score: it.max_score,
            reviewed: true,
            rubric_note: "",
            needs_image: it.needs_image,
            image_url: crop ?? (it.needs_image ? pageUrl : null),
            page_image_url: pageUrl,
          };
        });
        setItems(withUniqueQuestionNumbers(nextItems));
        const mcq = parsed.filter((it) => it.kind === "mcq").length;
        const frq = parsed.filter((it) => it.kind === "frq").length;
        const storageNote = storageNotes.length ? `页图没有保存：${storageNotes.join("；")}。` : "";
        setPdfNotice(storageNote);
        if (cropFails > 0) {
          toast.message(`已切出 ${mcq} 道选择题、${frq} 道大题，截到 ${figures} 张图表。${cropFails} 道带图题没截到，请点「在本页框选图表」补上。${storageNote}`);
        } else {
          toast.success(`已切出 ${mcq} 道选择题、${frq} 道大题，并从整页截出 ${figures} 张对应图表。AI 正在扫一眼切题质量。`);
        }
        setPdfBusy("保存切题结果…");
        const saved = await authFetch("/api/teacher/pdf", {
          method: "POST",
          body: JSON.stringify({
            action: "save-items",
            import_id: importId,
            items: nextItems,
          }),
        });
        if (!saved.ok) {
          const sj = await saved.json().catch(() => ({}));
          throw new Error(sj.error ?? "题目没能保存");
        }
        await loadPdfs();
        await runPdfAi(importId, nextItems);
      } else {
        await authFetch("/api/teacher/pdf", {
          method: "POST",
          body: JSON.stringify({ action: "save-items", import_id: importId, items: [] }),
        });
        const storageNote = storageNotes.length ? `页图也没保存：${storageNotes.join("；")}。` : "";
        const msg = `${visionError || "没有切出题目。这份 PDF 的文字对不上官方试卷的「1. (A)(B)(C)(D)」格式，AI 也没有从页图里认出完整题目。"} ${storageNote}已标成识别失败，可以手工加题后再提交。`.trim();
        setPdfNotice(msg);
        setItems([]);
        await loadPdfs();
        toast.error("没有切出题目，已标成识别失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF 处理失败");
    } finally {
      setPdfBusy("");
    }
  }

  async function openImport(id: string, opts?: { quietEmpty?: boolean }): Promise<{ pages: PdfPage[] } | null> {
    setActiveImport(id);
    setPdfNotice("");
    const r = await authFetch(`/api/teacher/pdf?id=${id}`);
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "无法打开");
      return null;
    }
    setPages(j.pages ?? []);
    setPdfClassId(String(j.import?.class_id ?? ""));
    const loadedPages = (j.pages ?? []) as PdfPage[];
    const nextItems: PdfItem[] = (j.items ?? []).map((it: PdfItem & { stem?: string | null; content?: string | null }) => {
        const unpacked = it.kind === "frq" ? splitTeacherFrq(it.content) : { content: it.content ?? "", rubric_note: it.rubric_note ?? "" };
        const page = loadedPages.find((p) => p.page_number === it.page_number);
        const blob = `${it.stem ?? ""} ${unpacked.content}`;
        const needs = it.needs_image ?? looksLikeProvidedFigure(blob);
        const printed = readPrintedScore(blob, 0);
        const storedScore = Number(it.max_score) || 0;
        const max_score = it.kind === "mcq"
          ? printed || storedScore || 1
          : printed || (storedScore >= 1 && storedScore !== 9 ? storedScore : 0);
        const stored = it.image_url && !isPageShot(it.image_url) ? it.image_url : null;
        return {
          ...emptyItem(it.page_number, it.sort_order, it.kind),
          ...it,
          stem: it.stem ?? "",
          option_a: it.option_a ?? "",
          option_b: it.option_b ?? "",
          option_c: it.option_c ?? "",
          option_d: it.option_d ?? "",
          option_e: it.option_e ?? "",
          correct_answer: it.correct_answer ?? "",
          content: unpacked.content,
          rubric_note: unpacked.rubric_note,
          max_score,
          image_url: stored,
          page_image_url: page?.image_url ?? null,
          needs_image: needs,
        };
      });
    const applied = sortPdfItems(applyKnownApAnswerKey(nextItems, j.import?.filename ?? ""));
    await Promise.all(
      applied.map(async (it) => {
        if (it.image_url || !it.needs_image) return;
        const page = loadedPages.find((p) => p.page_number === it.page_number);
        if (!page?.image_url) return;
        const url = cropUrlFromPage(page.image_url, it.kind, it.sort_order);
        if (await cropAlreadyStored(url).catch(() => false)) it.image_url = url;
      }),
    );
    const published = j.import?.status === "published";
    if (applied.length === 0 && !opts?.quietEmpty) {
      setPdfNotice("这份导入没有题目，不能当作已提交的试卷。请重新上传，或手工加题。");
    }
    if (!(applied.length === 0 && opts?.quietEmpty)) setItems(withUniqueQuestionNumbers(applied));
    setPdfFindings([]);
    setPdfAiRan(false);
    setPdfAiDone(published);
    setPdfTitle(j.import?.filename?.replace(/\.pdf$/i, "") ?? "");
    if (applied.length > 0 && !published) {
      void runPdfAi(id, applied);
    }
    return { pages: loadedPages };
  }

  async function deleteImport(id: string, status: string) {
    if (!window.confirm(status === "published" ? "从列表里去掉这份导入记录？已提交的学校卷不会自动删。" : "删除这份未提交的导入？")) return;
    const r = await authFetch("/api/teacher/pdf", {
      method: "POST",
      body: JSON.stringify({ action: "delete", import_id: id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(j.error ?? "删除失败");
      return;
    }
    if (activeImport === id) {
      setActiveImport("");
      setItems([]);
      setPages([]);
    }
    await loadPdfs();
    toast.success("已删除");
  }

  async function deleteDraftImports() {
    const n = imports.filter((imp) => imp.status !== "published").length;
    if (n === 0) {
      toast.message("没有未提交的导入");
      return;
    }
    if (!window.confirm(`删除 ${n} 份未提交的 PDF 导入？`)) return;
    const r = await authFetch("/api/teacher/pdf", {
      method: "POST",
      body: JSON.stringify({ action: "delete-drafts" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(j.error ?? "清理失败");
      return;
    }
    const still = imports.find((imp) => imp.id === activeImport && imp.status === "published");
    if (!still) {
      setActiveImport("");
      setItems([]);
      setPages([]);
    }
    await loadPdfs();
    toast.success("未提交的导入已清理");
  }

  async function replaceItemImage(index: number, file: File) {
    const it = items[index];
    if (!it) return;
    const local = URL.createObjectURL(file);
    const key = `${it.kind}-${it.sort_order}`;
    setPdfFindings((findings) => findings.filter((finding) => !(finding.key === key && missingImageFinding(finding.reason))));
    setItems((xs) => xs.map((row, i) => (i === index ? { ...row, image_url: local, needs_image: true } : row)));
    if (!pdfClassId || !activeImport) return;
    try {
      const uploaded = await putAssignmentPng(pdfClassId, activeImport, `${it.kind}-${it.sort_order}.png`, file);
      setItems((xs) => xs.map((row, i) => (i === index ? { ...row, image_url: uploaded, needs_image: true } : row)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "图片没能保存，先用本地预览");
    }
  }

  function recropItem(index: number) {
    const it = items[index];
    if (!it) return;
    const page = pages.find((p) => p.page_number === it.page_number);
    const local = pageBlobs.current.get(it.page_number);
    const pageUrl = local ? URL.createObjectURL(local) : page?.image_url;
    if (!pageUrl) {
      toast.error("没有这一页的图片，请用「替换图片」上传截图。");
      return;
    }
    setCropPick({ index, pageUrl });
  }

  async function saveAndPublish() {
    if (!activeImport) return;
    if (aiBusy || !pdfAiDone) {
      toast.error("请等 AI 审完这一遍再提交");
      return;
    }
    const missingScore = items.find((it) => it.kind === "frq" && !(it.max_score >= 1));
    if (missingScore) {
      toast.error(`Q${missingScore.sort_order} 还没有满分，请先填写`);
      return;
    }
    if (pdfFindings.length > 0 && !window.confirm(`AI 还标了 ${pdfFindings.length} 道题。确认已经看过，仍然提交？`)) {
      return;
    }
    setPdfBusy("保存并提交到后台…");
    try {
      const ready = withUniqueQuestionNumbers(applyKnownApAnswerKey(items, pdfTitle || "2022"));
      const saved = await authFetch("/api/teacher/pdf", {
        method: "POST",
        body: JSON.stringify({ action: "save-items", import_id: activeImport, items: ready }),
      });
      const sj = await saved.json();
      if (!saved.ok) throw new Error(sj.error ?? "保存失败");
      const item_images: Record<string, string> = {};
      for (const it of ready) {
        const crop = it.image_url && !it.image_url.startsWith("blob:") && !/\/page-\d+\.(png|jpe?g|webp)$/i.test(it.image_url)
          ? it.image_url
          : null;
        if (it.needs_image && crop) item_images[`${it.kind}-${it.sort_order}`] = crop;
      }
      const r = await authFetch("/api/teacher/pdf", {
        method: "POST",
        body: JSON.stringify({
          action: "publish",
          import_id: activeImport,
          title: pdfTitle,
          item_images,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "提交失败");
      toast.success(`已提交「${j.paper.title}」。可以去布置这场考试。`);
      if (roster.length === 0) {
        toast.message("先导入学生", {
          description: "名册还是空的，导入后才能把考试码发给学生。",
          action: { label: "去导入", onClick: () => go("roster") },
        });
      }
      await Promise.all([loadPdfs(), loadAssignments()]);
      setPaperId(j.paper.id);
      setSource("existing");
      setExamStep("edit");
      openTeacherPage("exam");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setPdfBusy("");
    }
  }

  const libraryPapers = useMemo(
    () => papers.filter((p) => !p.slug.startsWith("frq-") && !p.slug.startsWith("school-retired")),
    [papers],
  );
  const selectedPaper = libraryPapers.find((p) => p.id === paperId);
  const alreadyPublished = imports.find((imp) => imp.id === activeImport)?.status === "published";

  useLayoutEffect(() => {
    const id = search.exam || lastGradeId();
    if (!id) return;
    const cached = readGradeCache(id);
    if (!cached?.rows.length) return;
    const sameExam = gradeId === id;
    setGradeId((current) => (current === id ? current : id));
    setGradeRows((current) => (sameExam && current.length > 0 ? current : cached.rows));
    setGradeMeta((current) => (sameExam && current ? current : cached.meta));
  }, [search.exam, gradeId]);

  useEffect(() => {
    if (page !== "scores" || assignments.length === 0) return;
    const preferred = search.exam && assignments.some((item) => item.id === search.exam)
      ? search.exam
      : gradeId && assignments.some((item) => item.id === gradeId)
        ? gradeId
        : assignments[0].id;
    void loadGradebook(preferred, { keepPage: true });
  }, [page, assignments, search.exam, gradeId]);

  useEffect(() => {
    if (paperId) return;
    const first = libraryPapers[0];
    if (!first) return;
    const timing = paperSectionMinutes(first);
    setPaperId(first.id);
    setMcqMinutes(timing.mcq);
    setFrqMinutes(timing.frq);
    setBreakMinutes(timing.breakMinutes);
    const start = examInputMs(startsAt);
    if (Number.isFinite(start)) {
      setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(timing.mcq, timing.frq, timing.breakMinutes) * 60 * 1000)));
    }
  }, [libraryPapers, paperId, startsAt]);

  if (authLoading || (!ready && user && !denied && !checkFailed)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold">请先登录</h1>
          <p className="text-sm text-muted-foreground">教师工作台需要登录后才能布置考试。</p>
          <Button asChild className="w-full">
            <Link to="/auth" search={{ role: "teacher", redirect: "/teacher" }}>去登录</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">返回主页</Link>
          </Button>
        </div>
      </main>
    );
  }
  if (checkFailed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold">暂时无法确认教师身份</h1>
          <p className="text-sm text-muted-foreground">登录是成功的。服务器这次没有连上校验，并不是学生账号。</p>
          <Button className="w-full" onClick={() => void loadClass()}>重试</Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">返回主页</Link>
          </Button>
        </div>
      </main>
    );
  }
  if (denied) {
    if (isAdminEmail(user.email)) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-8 text-center">
            <h1 className="text-xl font-bold">登录校验没通过</h1>
            <p className="text-sm text-muted-foreground">这个账号可以进入教师端。服务器这次没有确认登录，请再试一次。</p>
            <Button className="w-full" onClick={() => void loadClass()}>重试</Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">返回主页</Link>
            </Button>
          </div>
        </main>
      );
    }
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold">学生账号没有教师端</h1>
          <p className="text-sm text-muted-foreground">学生使用学习主界面。教师请退出后，在登录页选择「教师」。</p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">返回主页</Link>
          </Button>
        </div>
      </main>
    );
  }

  const copy = PAGE_COPY[page];
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const rosterQueryText = rosterQuery.trim().toLowerCase();
  const shownRoster = rosterQueryText
    ? roster.filter((r) => `${r.student_id} ${r.student_name} ${r.account_name ?? ""}`.toLowerCase().includes(rosterQueryText))
    : roster;
  const scoreQueryText = scoreQuery.trim().toLowerCase();
  const shownGrades = scoreQueryText
    ? gradeRows.filter((r) => `${r.student_id} ${r.student_name} ${r.account_name ?? ""}`.toLowerCase().includes(scoreQueryText))
    : gradeRows;
  const submittedCount = gradeRows.filter((r) => r.status === "submitted").length;
  const inProgressCount = gradeRows.filter((r) => r.status === "in_progress").length;
  const unfinishedExam = assignments.find((item) => Date.parse(item.ends_at) > Date.now()) ?? null;
  const mcqDoneCount = gradeRows.filter((r) => r.status === "in_progress" && mcqHandedIn(r)).length;
  const stillOnMcqCount = inProgressCount - mcqDoneCount;
  const inProgressHint = !inProgressCount
    ? "没有人还在作答"
    : mcqDoneCount && stillOnMcqCount
      ? `${mcqDoneCount} 人已交选择题，${stillOnMcqCount} 人还在做选择题`
      : mcqDoneCount
        ? `${mcqDoneCount} 人已交选择题`
        : `${inProgressCount} 人作答中`;
  const liveCount = assignments.filter((a) => examWindow(a.starts_at, a.ends_at).label === "进行中").length;
  const latestExam = assignments[0] ?? null;
  const overviewRate = latestExam?.mcq_total ? Math.round(((latestExam.mcq_correct ?? 0) / latestExam.mcq_total) * 100) : null;
  const overviewAp = latestExam?.ap ?? summarizeApScores([]);
  const unsubmittedCount = latestExam ? Math.max(0, (latestExam.roster_count ?? 0) - (latestExam.submitted_count ?? 0)) : 0;
  const openFrqCount = latestExam?.pending_frq ?? 0;
  const classAp = summarizeApScores(gradeRows.filter((row) => row.status === "submitted").map(gradeAp), gradeMeta?.score_max);
  const pendingCount = unsubmittedCount + openFrqCount;
  const pendingHint = !latestExam
    ? "暂无待处理事项"
    : (() => {
        const examOver = examWindow(latestExam.starts_at, latestExam.ends_at).label === "已结束";
        const parts = [unsubmittedCount ? `${unsubmittedCount} 人${examOver ? "未参加" : "尚未交卷"}` : "", openFrqCount ? `${openFrqCount} 道大题没批完` : ""].filter(Boolean);
        return parts.length ? `最近一场${parts.join("，")}` : "最近一场没有待处理";
      })();
  const gradeRate = mcqRate(gradeRows);
  const bestScore = gradeRows.reduce((best, row) => {
    if (row.mcq_correct == null || !row.mcq_total) return best;
    return Math.max(best, row.mcq_correct / row.mcq_total);
  }, -1);
  const scoresPending = page === "scores" && !gradeMeta && gradeRows.length === 0;
  const reviewRows = gradeRows.filter((row) => (row.frqs ?? []).some((frq) => frq.needs_review));
  const questionNotes = frqClassNotes(gradeRows);
  const pendingFrqCount = gradeRows.reduce((sum, row) => sum + (row.status === "submitted" ? (row.frqs ?? []).filter((frq) => frq.manual_score == null && frq.ai_score == null && (frq.answer_text.trim() || frq.file_url)).length : 0), 0);
  const pendingGradeError = gradeRows.flatMap((row) => row.status === "submitted" ? (row.frqs ?? []) : []).find((frq) => frq.ai_score == null && frq.manual_score == null && frq.ai_error)?.ai_error ?? "";
  const examStillOpen = !!gradeMeta && Date.parse(gradeMeta.ends_at) > Date.now();
  const mcqHeaders = columnNumbers(gradeRows, (row) => row.mcqs, (item) => item.n);
  const frqHeaders = columnNumbers(gradeRows, (row) => row.frqs, (frq) => frq.sort_order);
  const frqWaiting = gradeRows.some((row) => row.status === "submitted" && (row.frqs ?? []).some((frq) => (frq.answer_text.trim() || frq.file_url) && frq.manual_score == null && frq.ai_score == null));
  const publishBlock = !gradeMeta
    ? ""
    : examStillOpen
      ? "考试还在进行，先不要公布"
      : inProgressCount > 0
        ? "还有已开考的答卷没能收上。刷新后会再收一次，收完才能公布"
        : frqWaiting
          ? `还有 ${pendingFrqCount} 道写过的大题没批完。已经出分的会保留，批完再公布`
          : "";
  const paperLabel = source === "random"
    ? "固定随机卷（60 道选择题 + 3 道大题）"
    : selectedPaper
      ? paperPickerLabel(selectedPaper)
      : "未选择";

  function openTeacherPage(next: TeacherPage, examId?: string) {
    const exam = examId || (next === "scores" ? gradeId || search.exam : undefined);
    void navigate({
      to: "/teacher",
      search: {
        ...(next === "overview" ? {} : { page: next }),
        ...(exam ? { exam } : {}),
      },
      replace: true,
    });
  }

  function go(next: TeacherPage) {
    openTeacherPage(next);
    if (next === "exam" && examStep === "edit" && !title.trim()) {
      const start = new Date();
      const timing = source === "existing" && selectedPaper ? paperSectionMinutes(selectedPaper) : { mcq: MCQ_MINUTES_DEFAULT, frq: FRQ_MINUTES_DEFAULT, breakMinutes: BREAK_MINUTES_DEFAULT };
      setStartsAt(toBeijingInput(start));
      setMcqMinutes(timing.mcq);
      setFrqMinutes(timing.frq);
      setBreakMinutes(timing.breakMinutes);
      setEndsAt(toBeijingInput(new Date(start.getTime() + sectionTotalMinutes(timing.mcq, timing.frq, timing.breakMinutes) * 60 * 1000)));
    }
  }

  function reviewExam() {
    if (roster.length === 0) {
      toast.error("还没有学生。可以先点「导入测试学号」，或去学生名册粘贴名单。");
      return;
    }
    if (!title.trim()) {
      toast.error("请先填写考试名称");
      return;
    }
    if (source === "existing" && !paperId) {
      toast.error("请选择一份试卷");
      return;
    }
    const starts = examInputMs(startsAt);
    const ends = examInputMs(endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
      toast.error("请设置有效的开考和截止时间");
      return;
    }
    const sectionError = sectionMinutesError(mcqMinutes, frqMinutes, frqMinutes > 0 ? breakMinutes : 0);
    if (sectionError) {
      toast.error(sectionError);
      return;
    }
    const maxError = scoreMaxError(scoreMax);
    if (maxError) {
      toast.error(maxError);
      return;
    }
    const sectionMs = sectionTotalMinutes(mcqMinutes, frqMinutes, frqMinutes > 0 ? breakMinutes : 0) * 60 * 1000;
    if (ends - starts + 90_000 < sectionMs) {
      toast.error("截止时间要盖住选择题、休息和大题");
      return;
    }
    setExamStep("review");
  }

  function submitProgress(exam: Assignment) {
    if (typeof exam.roster_count !== "number") return "—";
    return `${exam.submitted_count ?? 0} / ${exam.roster_count}`;
  }

  function accuracyLabel(exam: Assignment) {
    if (!exam.mcq_total) return "—";
    return `${Math.round(((exam.mcq_correct ?? 0) / exam.mcq_total) * 100)}%`;
  }

  return (
    <div className="teacher-console flex min-h-screen flex-col">
      <header className="border-b border-white/60 px-4 py-3 md:px-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                返回主页
              </Link>
            </Button>
            <span className="truncate text-sm text-muted-foreground">
              教师端 / <span className="text-foreground">{copy[0]}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={openStudentSimulation}>
              <Eye className="h-4 w-4" />
              模拟学生视角
            </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex max-w-[50vw] items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm font-medium hover:bg-white/60">
                <span className="teacher-avatar grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {(accountLabel[0] ?? "教").toUpperCase()}
                </span>
                <span className="truncate">{accountLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link to="/profile">个人资料</Link>
              </DropdownMenuItem>
              {isAdminEmail(user.email) && (
                <DropdownMenuItem asChild>
                  <Link to="/admin">管理后台</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()}>
                <LogOut className="mr-2 h-4 w-4" />退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
        <nav className="mx-auto mt-3 flex w-full max-w-6xl gap-1 overflow-auto" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-white/70",
                  active && "bg-primary/10 font-semibold text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-16 md:px-10 md:py-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold tracking-wide text-primary">AP MICROECONOMICS</p>
              <h1 className="text-2xl font-bold tracking-tight md:text-[27px]">{copy[1]}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {page === "overview"
                  ? roster.length > 0
                    ? assignments.length > 0
                      ? "名册和考试都已就绪，可以从最近考试进入成绩。"
                      : "名册已导入，可以布置考试了。"
                    : copy[2]
                  : copy[2]}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {roster.length > 0 && assignments.length > 0 ? null : (
                <Button type="button" size="sm" className="theme-toggle" aria-pressed={minecraft} onClick={toggleMinecraft}>
                  <span aria-hidden="true">{minecraft ? "☀️" : "🟩"}</span>
                  {minecraft ? "切换回简约风格" : "切换到 Minecraft 风格"}
                </Button>
              )}
              <span className="hidden rounded-full border border-white/80 bg-white/55 px-3 py-2 text-xs text-muted-foreground sm:inline-flex">
                {todayLabel}
              </span>
            </div>
          </div>

          {page === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="我的学生" value={roster.length} hint={roster.length ? `${roster.filter((r) => r.user_id).length} 人已入场绑定` : "尚未导入学生"} icon={Users} />
                <StatCard label="进行中的考试" value={liveCount} hint={assignments.length ? `共布置 ${assignments.length} 场` : "创建考试后会显示在这里"} icon={ClipboardList} />
                <StatCard label="平均 AP 分" value={examsLoaded || assignments.length > 0 ? formatApAverage(overviewAp) : "—"} hint={overviewAp.average != null ? `最近一场已换算 ${overviewAp.scored} 人${openFrqCount ? `，另有 ${openFrqCount} 道大题没批完` : ""}${overviewRate != null ? `，选择题正确率 ${overviewRate}%` : ""}` : openFrqCount || overviewAp.pending ? "最近一场大题还没出分" : "最近一场还没有可换算的成绩"} icon={BarChart3} />
                <StatCard label="待处理" value={examsLoaded || assignments.length > 0 ? pendingCount : "—"} hint={pendingHint} icon={Clock} />
              </div>
              <div className={cn("grid gap-4", roster.length > 0 && assignments.length > 0 ? "" : "lg:grid-cols-[1.35fr_1fr]")}>
                {roster.length > 0 && assignments.length > 0 ? null : (
                <section className="glass rounded-2xl p-5">
                  <h2 className="text-[15px] font-semibold">开始使用</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">完成以下步骤即可开始管理课程</p>
                  <div className="mt-2 divide-y divide-white/70">
                    <div className="flex items-center gap-3 py-3">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", roster.length ? "bg-success" : "bg-primary")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">第 1 步：导入学生名册</p>
                        <p className="text-xs text-muted-foreground">粘贴学号和姓名，建立班级名单</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => go("roster")}>导入学生</Button>
                    </div>
                    <div className="flex items-center gap-3 py-3">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", assignments.length ? "bg-success" : "bg-muted-foreground/30")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">第 2 步：布置考试</p>
                        <p className="text-xs text-muted-foreground">选择试卷并设置考试时间</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => go("exam")}>创建考试</Button>
                    </div>
                  </div>
                </section>
                )}
                <section className="glass rounded-2xl p-5">
                  <h2 className="text-[15px] font-semibold">快捷操作</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">常用教学入口</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => go("exam")}><Plus className="h-4 w-4" />布置考试</Button>
                    <Button variant="outline" onClick={() => go("roster")}>导入学生</Button>
                    <Button variant="outline" onClick={() => go("pdf")}>上传 PDF</Button>
                  </div>
                  <p className="mt-4 rounded-xl bg-white/50 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    {roster.length > 0 ? "名册已导入。可以布置考试，或从最近考试查看成绩。" : "完成名册导入后，即可开始布置考试并查看成绩。"}
                  </p>
                </section>
              </div>
              <section className="glass overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <h2 className="text-[15px] font-semibold">最近考试</h2>
                    <p className="text-xs text-muted-foreground">查看提交进度与班级表现</p>
                  </div>
                  <Button onClick={() => go("exam")}><Plus className="h-4 w-4" />布置考试</Button>
                </div>
                {!examsLoaded && assignments.length === 0 ? (
                  <EmptyState icon={ClipboardList} title="正在读取考试" hint="上次看到的考试会先留在这里。" />
                ) : assignments.length === 0 ? (
                  <EmptyState icon={ClipboardList} title="还没有考试" hint="导入学生后，点击「布置考试」创建第一场考试。" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>考试名称</TableHead>
                          <TableHead>截止时间</TableHead>
                          <TableHead>考试码</TableHead>
                          <TableHead>提交情况</TableHead>
                          <TableHead>正确率</TableHead>
                          <TableHead>AP 分</TableHead>
                          <TableHead>得分</TableHead>
                          <TableHead>状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.slice(0, 6).map((a) => {
                          const win = examWindow(a.starts_at, a.ends_at);
                          return (
                            <TableRow key={a.id} className="cursor-pointer" onClick={() => void loadGradebook(a.id)}>
                              <TableCell className="font-medium">
                                {a.title}
                                {a.class_name ? <div className="text-[11px] font-normal text-muted-foreground">{a.class_name}{a.teacher_name ? ` · ${a.teacher_name}` : ""}</div> : null}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">{beijingTime(a.ends_at).slice(0, 16)}</TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  className="rounded-md px-1 font-mono text-xs tracking-wide text-primary hover:bg-primary/10"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void copyCode(a.exam_code);
                                  }}
                                >
                                  {copied === a.exam_code ? "已复制" : a.exam_code}
                                </button>
                              </TableCell>
                              <TableCell>{submitProgress(a)}</TableCell>
                              <TableCell>{accuracyLabel(a)}</TableCell>
                              <TableCell className="tabular-nums" title={a.ap?.scored ? apDistributionText(a.ap) : undefined}>{formatApAverage(a.ap)}</TableCell>
                              <TableCell className="tabular-nums">{formatScaledScore(a.ap?.averageCustom, a.score_max ?? a.ap?.scoreMax)}</TableCell>
                              <TableCell><Pill tone={win.tone}>{win.label}</Pill></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </div>
          )}

          {page === "roster" && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">学生名册</h2>
                  <p className="mt-1 text-xs text-muted-foreground">导入一次即可复用。追加不会清掉已有学生；覆盖会整表替换，有未结束的考试时不能覆盖。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => openStudentEditor()}>手动添加</Button>
                  <Button onClick={() => void importRoster(false)}>导入学生</Button>
                </div>
              </div>
              <section className="glass rounded-2xl p-5">
                <h2 className="text-[15px] font-semibold">快速导入</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">从 Excel 复制「学号、姓名」两列，粘贴到这里</p>
                <Textarea
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="mt-4 min-h-[8rem] font-mono text-sm"
                  placeholder={"例如：\n2026001, 张小明\n2026002, 王小雨"}
                  aria-label="花名册 CSV"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">支持逗号或制表符分隔。表头含「学号」时会自动跳过。</p>
                {unfinishedExam ? <p className="mt-2 text-xs text-amber-800">「{unfinishedExam.title}」还没结束，现在不能覆盖名册。</p> : null}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => void importRoster(false)}>追加导入</Button>
                  <Button type="button" variant="outline" onClick={() => void importTestRoster()}>导入测试学号</Button>
                  <Button
                    variant="outline"
                    disabled={!!unfinishedExam}
                    onClick={() => {
                      if (unfinishedExam) return;
                      if (parseRosterCsv(csvText).length === 0) {
                        toast.error("没有读到学号/姓名");
                        return;
                      }
                      setReplaceRosterOpen(true);
                    }}
                  >
                    覆盖导入
                  </Button>
                </div>
              </section>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={rosterQuery}
                  onChange={(e) => setRosterQuery(e.target.value)}
                  placeholder="搜索姓名或学号"
                  className="max-w-xs"
                />
                <span className="text-xs text-muted-foreground">共 {shownRoster.length} 位学生</span>
              </div>
              <section className="glass overflow-hidden rounded-2xl">
                {roster.length === 0 ? (
                  <EmptyState icon={Users} title="还没有学生" hint="粘贴学号和姓名，导入你的第一批学生。" />
                ) : shownRoster.length === 0 ? (
                  <EmptyState icon={Users} title="没有匹配的学生" hint="换一个姓名或学号再搜一次。" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>学号</TableHead>
                          <TableHead>姓名</TableHead>
                          <TableHead>班级</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shownRoster.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono">{r.student_id}</TableCell>
                            <TableCell className="font-medium">
                              {r.student_name}
                              {r.account_name && r.account_name !== r.student_name ? (
                                <div className="text-[11px] font-normal text-muted-foreground">注册姓名：{r.account_name}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>本班</TableCell>
                            <TableCell>
                              <Pill tone={r.user_id ? "ok" : "muted"}>{r.user_id ? "已绑定" : "未入场"}</Pill>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button type="button" variant="ghost" size="sm" onClick={() => openStudentEditor(r)}>编辑</Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => void deleteStudent(r)}>
                                <Trash2 className="h-4 w-4" />
                                删除
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </div>
          )}

          {page === "exam" && (
            <div className="space-y-4">
              {roster.length === 0 ? (
                <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
                  先导入学生。名册还是空的，导入后才能把考试码发给学生。
                  <button type="button" className="ml-2 font-semibold underline" onClick={() => go("roster")}>去导入学生</button>
                </p>
              ) : null}
              <section className="glass max-w-3xl rounded-2xl p-5 md:p-6">
                <div className="mb-6 flex items-center gap-3 text-xs">
                  <div className={cn("flex items-center gap-2", examStep === "edit" ? "font-semibold text-primary" : "text-foreground")}>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {examStep === "edit" ? "1" : "✓"}
                    </span>
                    考试设置
                  </div>
                  <span className="h-px max-w-16 flex-1 bg-border" />
                  <div className={cn("flex items-center gap-2", examStep === "review" ? "font-semibold text-primary" : "text-muted-foreground")}>
                    <span className={cn(
                      "grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold",
                      examStep === "edit" ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                    )}>
                      {examStep === "done" ? "✓" : "2"}
                    </span>
                    确认发布
                  </div>
                </div>

                {examStep === "done" && publishedExam ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-success/10 px-4 py-3 text-sm text-success">
                      考试「{publishedExam.title}」已创建。把考试码发给学生即可入场。
                    </div>
                    <p className="text-xs text-muted-foreground">考试码是 6 位字母和数字，例如 K7PGAD。学生按原样输入，不只能填数字。</p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <span className="font-mono text-2xl tracking-[0.18em]">{publishedExam.code}</span>
                      <Button variant="outline" onClick={() => void copyCode(publishedExam.code)}>
                        {copied === publishedExam.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied === publishedExam.code ? "已复制" : "复制考试码"}
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-white/70 pt-4 sm:flex-row">
                      <Button variant="outline" onClick={() => { setExamStep("edit"); setPublishedExam(null); }}>再布置一场</Button>
                      <Button onClick={() => void loadGradebook(gradeId)}>查看成绩</Button>
                    </div>
                  </div>
                ) : examStep === "review" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/80 bg-white/45 p-4">
                      <h3 className="mb-3 text-sm font-semibold">请确认考试信息</h3>
                      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
                        <dt className="text-muted-foreground">考试名称</dt><dd className="font-medium">{title}</dd>
                        <dt className="text-muted-foreground">班级与人数</dt><dd className="font-medium">本班，共 {roster.length} 人</dd>
                        <dt className="text-muted-foreground">试卷</dt><dd className="font-medium">{paperLabel}</dd>
                        <dt className="text-muted-foreground">分段计时</dt>
                        <dd className="font-medium">
                          {frqMinutes > 0
                            ? `选择题 ${mcqMinutes} 分钟 + 大题 ${frqMinutes} 分钟${breakMinutes ? `，休息 ${breakMinutes} 分钟` : ""}`
                            : `选择题 ${mcqMinutes} 分钟`}
                        </dd>
                        <dt className="text-muted-foreground">满分</dt>
                        <dd className="font-medium">{scoreMax} 分，AP 1–5 仍按 90 分综合分</dd>
                        <dt className="text-muted-foreground">考试时间</dt>
                        <dd className="font-medium">北京时间 {beijingInputLabel(startsAt)} 至 {beijingInputLabel(endsAt)}</dd>
                        <dt className="text-muted-foreground">防作弊</dt>
                        <dd className="font-medium">离开页面会提醒，关闭页面前会再确认一次</dd>
                        <dt className="text-muted-foreground">公布答案</dt>
                        <dd className="font-medium">{publishAnswers ? "交卷后公布答案和解析" : "交卷后不公布，之后可在成绩册公布"}</dd>
                        <dt className="text-muted-foreground">AI 批改</dt>
                        <dd className="font-medium">{aiGradeFrq ? "截止后批改" : "只收答卷，不自动批大题"}</dd>
                      </dl>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-white/70 pt-4 sm:flex-row sm:justify-between">
                      <Button variant="outline" onClick={() => setExamStep("edit")}>返回修改</Button>
                      <Button onClick={() => void createAssignment()} disabled={creating}>
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        生成考试码并发布
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Field label="考试名称">
                      <Input placeholder="例如：Unit 2 供需与弹性测验" value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                    <Field label="班级" hint="一个老师目前对应一个班。有学生后才能发布。">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input readOnly value={roster.length ? `本班（${roster.length} 人）` : "还没有学生"} className="flex-1" />
                        {roster.length === 0 ? (
                          <Button type="button" variant="outline" onClick={() => void importTestRoster()}>导入测试学号</Button>
                        ) : null}
                      </div>
                    </Field>
                    <Field label="试卷来源">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={cn(
                            "rounded-xl border px-3 py-2 text-sm",
                            source === "existing" ? "border-primary/40 bg-primary/10 font-medium text-primary" : "border-border bg-white/60 text-muted-foreground",
                          )}
                          onClick={() => setSource("existing")}
                        >
                          从现有题库选择
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "rounded-xl border px-3 py-2 text-sm",
                            source === "random" ? "border-primary/40 bg-primary/10 font-medium text-primary" : "border-border bg-white/60 text-muted-foreground",
                          )}
                          onClick={() => {
                            setSource("random");
                            const start = examInputMs(startsAt);
                            setMcqMinutes(MCQ_MINUTES_DEFAULT);
                            setFrqMinutes(FRQ_MINUTES_DEFAULT);
                            setBreakMinutes(BREAK_MINUTES_DEFAULT);
                            if (Number.isFinite(start)) {
                              setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(MCQ_MINUTES_DEFAULT, FRQ_MINUTES_DEFAULT, BREAK_MINUTES_DEFAULT) * 60 * 1000)));
                            }
                          }}
                        >
                          生成固定随机卷
                        </button>
                      </div>
                    </Field>
                    {source === "existing" ? (
                      <Field label="选择试卷" hint="选择已有题卷，学生将完成同一套题目。">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Select value={paperId || undefined} onValueChange={(id) => {
                            setPaperId(id);
                            const paper = libraryPapers.find((item) => item.id === id);
                            if (!paper) return;
                            const timing = paperSectionMinutes(paper);
                            setMcqMinutes(timing.mcq);
                            setFrqMinutes(timing.frq);
                            setBreakMinutes(timing.breakMinutes);
                            const start = examInputMs(startsAt);
                            if (Number.isFinite(start)) {
                              setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(timing.mcq, timing.frq, timing.breakMinutes) * 60 * 1000)));
                            }
                          }}>
                            <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="选择试卷" /></SelectTrigger>
                            <SelectContent>
                              {libraryPapers.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{paperPickerLabel(p)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" disabled={!selectedPaper} onClick={() => setPreviewOpen(true)}>预览试卷</Button>
                        </div>
                      </Field>
                    ) : (
                      <Field label="随机卷范围" hint="开考前抽好 60 题选择题 + 3 道大题，全班同一套。">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input readOnly value="全部已发布题目" className="flex-1" />
                          <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>预览说明</Button>
                        </div>
                      </Field>
                    )}
                    {source === "existing" && selectedPaper && !selectedPaper.slug.startsWith("school-") && (
                      <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">
                        这是公开卷库。未走考试入场的学生仍可能在「模考」里练习同一份卷。课上请只用考试码入场；随机卷或 PDF 导入卷不会出现在公开模考列表。
                      </p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="开始时间">
                        <Input
                          type="datetime-local"
                          className="min-w-0 w-full text-sm"
                          value={startsAt}
                          onChange={(e) => {
                            const value = e.target.value;
                            setStartsAt(value);
                            const start = Date.parse(value);
                            if (!Number.isFinite(start)) return;
                            setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(mcqMinutes, frqMinutes, frqMinutes > 0 ? breakMinutes : 0) * 60 * 1000)));
                          }}
                        />
                      </Field>
                      <Field label="截止时间" hint="默认等于各段时长相加。可以再延后，给学生留迟到缓冲。">
                        <Input
                          type="datetime-local"
                          className="min-w-0 w-full text-sm"
                          value={endsAt}
                          onChange={(e) => setEndsAt(e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="选择题（分钟）" hint="官方卷默认 70 分钟。快速测试可以填 1 分钟起。改时长会重算截止时间。">
                        <Input
                          type="number"
                          min={1}
                          max={180}
                          value={mcqMinutes}
                          onChange={(e) => {
                            const mins = Math.round(Number(e.target.value));
                            if (!Number.isFinite(mins)) return;
                            setMcqMinutes(mins);
                            const start = examInputMs(startsAt);
                            if (!Number.isFinite(start)) return;
                            setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(mins, frqMinutes, frqMinutes > 0 ? breakMinutes : 0) * 60 * 1000)));
                          }}
                        />
                      </Field>
                      <Field label="大题（分钟）" hint="官方卷默认 60 分钟。填 0 表示这场没有大题。">
                        <Input
                          type="number"
                          min={0}
                          max={180}
                          value={frqMinutes}
                          onChange={(e) => {
                            const mins = Math.round(Number(e.target.value));
                            if (!Number.isFinite(mins)) return;
                            const nextBreak = mins > 0 ? breakMinutes : 0;
                            setFrqMinutes(mins);
                            setBreakMinutes(nextBreak);
                            const start = examInputMs(startsAt);
                            if (!Number.isFinite(start)) return;
                            setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(mcqMinutes, mins, nextBreak) * 60 * 1000)));
                          }}
                        />
                      </Field>
                      <Field label="休息（分钟）" hint="选择题和大题之间，学生可以跳过。">
                        <Input
                          type="number"
                          min={0}
                          max={20}
                          disabled={frqMinutes <= 0}
                          value={frqMinutes > 0 ? breakMinutes : 0}
                          onChange={(e) => {
                            const mins = Math.round(Number(e.target.value));
                            if (!Number.isFinite(mins)) return;
                            setBreakMinutes(mins);
                            const start = examInputMs(startsAt);
                            if (!Number.isFinite(start)) return;
                            setEndsAt(toBeijingInput(new Date(start + sectionTotalMinutes(mcqMinutes, frqMinutes, mins) * 60 * 1000)));
                          }}
                        />
                      </Field>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      这场合计 {sectionTotalMinutes(mcqMinutes, frqMinutes, frqMinutes > 0 ? breakMinutes : 0)} 分钟：选择题 {mcqMinutes} 分钟{frqMinutes > 0 ? ` + 休息 ${frqMinutes > 0 ? breakMinutes : 0} 分钟 + 大题 ${frqMinutes} 分钟` : ""}。截止时间按这个合计重算，也可以再延后。
                    </p>
                    <Field label="满分" hint="这里默认 100 分，是给学生看的折算分。AP 1–5 另外按 90 分综合分换算，两套分会一起留下。">
                      <Input
                        type="number"
                        min={10}
                        max={300}
                        step={1}
                        className="w-32"
                        value={scoreMax}
                        onChange={(e) => setScoreMax(Math.round(Number(e.target.value) || 0))}
                      />
                    </Field>
                    <ul className="list-disc space-y-1 rounded-xl bg-amber-500/10 px-6 py-2 text-xs leading-relaxed text-amber-900">
                      <li>学生用学号、姓名和考试码进入。考试码是 6 位字母和数字，例如 K7PGAD。</li>
                      <li>选择题和大题分开倒计时。一段时间到了就进入下一段，休息可以跳过。</li>
                      <li>整场到截止时间会自动交卷。开始得晚，后面的段落可能被截止时间截短。</li>
                      <li>离开考试页面会提醒，关闭页面前会再确认一次。</li>
                      <li>未交卷可以在截止前重新进入。已提交的答卷不能重复提交。选择题交卷后不能再改。</li>
                    </ul>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white/70 px-3 py-3">
                        <span>
                          <span className="block text-sm font-medium">交卷后公布答案和解析</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">学生交卷后只看到结束页。分数和解析留在教师端，考试结束并批完大题后才能公布。</span>
                        </span>
                        <Switch checked={publishAnswers} onCheckedChange={setPublishAnswers} aria-label="交卷后公布答案和解析" />
                      </div>
                      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white/70 px-3 py-3">
                        <span>
                          <span className="block text-sm font-medium">大题用 AI 批改</span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">考试截止并且答卷都收齐后，自动批完全部大题。不用等老师点批改。</span>
                        </span>
                        <Switch checked={aiGradeFrq} onCheckedChange={setAiGradeFrq} aria-label="大题用 AI 批改" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-white/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs text-muted-foreground">预计考试人数：{roster.length} 人</span>
                      <Button onClick={reviewExam}>检查并继续</Button>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-[15px] font-semibold">已布置的考试</h2>
                {!examsLoaded && assignments.length === 0 ? (
                  <div className="glass rounded-2xl">
                    <EmptyState icon={ClipboardList} title="正在读取考试" hint="上次看到的考试会先留在这里。" />
                  </div>
                ) : assignments.length === 0 ? (
                  <div className="glass rounded-2xl">
                    <EmptyState icon={ClipboardList} title="还没有考试" hint="生成考试码后发给学生。考试码是 6 位字母和数字，例如 K7PGAD。" />
                  </div>
                ) : assignments.map((a) => {
                  const win = examWindow(a.starts_at, a.ends_at);
                  return (
                    <div key={a.id} className="glass flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{a.title}</h3>
                          <Pill tone={win.tone}>{win.label}</Pill>
                          <Pill tone={a.results_published ? "ok" : "muted"}>
                            {a.results_published ? "已公布解析" : "未公布解析"}
                          </Pill>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {a.class_name ? `${a.class_name}${a.teacher_name ? ` · ${a.teacher_name}` : ""} · ` : ""}
                          {a.paper?.title ?? "试卷"} · {assignmentTiming(a)} · 满分 {a.score_max ?? "—"} · 平均 {formatScaledScore(a.ap?.averageCustom, a.score_max ?? a.ap?.scoreMax)} · AP {formatApAverage(a.ap)} · 正确率 {accuracyLabel(a)} · 北京时间 {beijingTime(a.starts_at).slice(0, 16)} – {beijingTime(a.ends_at).slice(0, 16)}
                        </p>
                        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                          <span className="font-mono text-lg tracking-[0.14em]">{a.exam_code}</span>
                          <span className="text-[11px] text-muted-foreground">6 位字母和数字</span>
                          <Button size="sm" variant="outline" className="h-8 w-full gap-1 sm:w-auto" onClick={() => void copyCode(a.exam_code)}>
                            {copied === a.exam_code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied === a.exam_code ? "已复制" : "复制考试码"}
                          </Button>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void loadGradebook(a.id)}>
                        查看成绩
                      </Button>
                    </div>
                  );
                })}
              </section>
            </div>
          )}

          {page === "scores" && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">成绩分析</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAdminEmail(user.email)
                      ? "这里是全部教师的考试成绩。考试截止后会批完全部大题，点某一行再看这名学生的答卷。"
                      : "先看全班成绩。考试截止后会自动批完全部大题，点某一行再看这名学生的答卷。"}
                  </p>
                  {!gradePaused && (gradeNote || (pendingFrqCount > 0 && !examStillOpen && gradeMeta?.ai_grade !== false)) ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {classGradeDue || gradeBusy === "ai" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                      <p className="text-sm text-muted-foreground">
                        {liveRetryNote(gradeNote, gradeRetryAt, gradeClock || Date.now())
                          ? `${liveRetryNote(gradeNote, gradeRetryAt, gradeClock || Date.now())}${pendingFrqCount > 0 && !/还剩|请求过多|没批完|可重试|批改失败/.test(gradeNote) ? `，还有 ${pendingFrqCount} 题没批完` : ""}`
                          : pendingGradeError
                            ? pendingGradeError
                            : `还有 ${pendingFrqCount} 题没批完。已经出分的会保留。`}
                      </p>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => void regradeClass()}>重新批改未出分的题</Button>
                      {classGradeDue || gradeBusy === "ai" ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={stopAutoGrade}>停止</Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {gradePaused && pendingFrqCount > 0 ? (
                    <Button variant="outline" onClick={() => void regradeClass()}>继续批改</Button>
                  ) : null}
                  <Button variant="outline" disabled={!gradeRows.length} onClick={exportCsv}>导出成绩</Button>
                </div>
              </div>
              {!examsLoaded && assignments.length === 0 ? (
                <div className="glass rounded-2xl">
                  <EmptyState icon={BarChart3} title="正在读取考试" hint="上次看到的考试会先留在这里。" />
                </div>
              ) : assignments.length === 0 ? (
                <div className="glass rounded-2xl">
                  <EmptyState icon={BarChart3} title="还没有可查看的考试" hint="先到「布置考试」生成考试码，学生交卷后这里会出现成绩。" />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select value={gradeId || undefined} onValueChange={(id) => void loadGradebook(id)}>
                      <SelectTrigger className="w-full sm:max-w-xs"><SelectValue placeholder="选择一场考试" /></SelectTrigger>
                      <SelectContent>
                        {assignments.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.class_name ? `${a.class_name} · ${a.title}` : a.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={scoreQuery}
                      onChange={(e) => setScoreQuery(e.target.value)}
                      placeholder="搜索学生"
                      className="w-full sm:max-w-xs"
                    />
                    {gradeMeta?.results_published ? (
                      <Button className="sm:ml-auto" variant="outline" onClick={() => void togglePublish(false)}>取消公布成绩</Button>
                    ) : publishBlock ? (
                      <p className="text-xs text-muted-foreground sm:ml-auto">{publishBlock}</p>
                    ) : gradeMeta ? (
                      <Button className="sm:ml-auto" onClick={() => void togglePublish(true)}>公布成绩与解析</Button>
                    ) : null}
                    {gradeId && (examStillOpen || inProgressCount > 0) ? (
                      <Button variant="outline" disabled={gradeBusy !== null} onClick={() => setEndConfirm(true)}>提前结束考试</Button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard label="平均 AP 分" value={scoresPending ? "—" : formatApAverage(classAp)} hint={scoresPending ? "正在读取成绩" : classAp.averageCustom != null ? `折算均分 ${formatScaledScore(classAp.averageCustom, classAp.scoreMax)}` : classAp.scored ? `已换算 ${classAp.scored} 人${classAp.pending ? `，${classAp.pending} 人待出分` : ""}` : classAp.pending ? "大题批完后换算" : "交卷后按 1–5 分换算"} />
                    <StatCard label="班级正确率" value={scoresPending || gradeRate == null ? "—" : `${gradeRate}%`} hint={scoresPending ? "正在读取成绩" : gradeRate == null ? "暂无成绩数据" : "已交卷选择题"} />
                    <StatCard
                      label="已提交"
                      value={scoresPending ? "—" : gradeId ? `${submittedCount} / ${gradeRows.length || roster.length}` : "—"}
                      hint={scoresPending ? "正在读取成绩" : gradeId ? inProgressHint : "请选择一场考试"}
                    />
                    <StatCard label="最高 AP 分" value={scoresPending || classAp.best == null ? "—" : classAp.best} hint={scoresPending ? "正在读取成绩" : classAp.bestCustom != null ? `最高折算 ${formatScaledScore(classAp.bestCustom, classAp.scoreMax)}` : bestScore < 0 ? "暂无成绩数据" : `最高选择题正确率 ${Math.round(bestScore * 100)}%`} />
                  </div>
                  {classAp.scored > 0 ? (
                    <p className="text-xs text-muted-foreground">AP 分布：{apDistributionText(classAp)}。选择题占三分之二，大题占三分之一；综合分满分 90，70 分为 5，57 分为 4，45 分为 3，36 分为 2。{gradeMeta?.score_max ? `老师设定满分 ${gradeMeta.score_max}，班均 ${formatScaledScore(classAp.averageCustom, gradeMeta.score_max)}。` : ""}</p>
                  ) : null}
                  {reviewRows.length > 0 ? (
                    <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-950">
                      {reviewRows.length} 名学生有建议复核的大题，名单里用黄色标出，请优先改分。
                    </p>
                  ) : null}
                  {questionNotes.length > 0 ? (
                    <section className="glass rounded-2xl px-5 py-4">
                      <h2 className="text-[15px] font-semibold">按题目</h2>
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {questionNotes.map((item) => (
                          <li key={item.n}>
                            Q{item.n} 平均 {item.avg.toFixed(1)}/{item.max}（{item.count} 人已出分）
                            {item.worst ? `。丢分最多：${item.worst.point}（${item.worst.miss}/${item.worst.seen} 人没拿满）` : ""}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <section className="glass overflow-hidden rounded-2xl">
                    <div className="px-5 py-4">
                      <h2 className="text-[15px] font-semibold">成绩花名册</h2>
                      <p className="text-xs text-muted-foreground">{gradeMeta ? `${gradeMeta.title} · 点一行查看答卷` : "选择考试后显示全班成绩"}</p>
                    </div>
                    {scoresPending ? (
                      <EmptyState icon={BarChart3} title="正在读取成绩" hint="成绩册加载完成后会显示交卷人数和分数。" />
                    ) : !gradeId ? (
                      <EmptyState icon={BarChart3} title="请选择一场考试" hint="从上方选择考试，或从工作台点进一场考试。" />
                    ) : shownGrades.length === 0 ? (
                      <EmptyState icon={Users} title="还没有成绩" hint="布置考试并收集答卷后，这里会显示学生成绩。" />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="sticky left-0 z-10 bg-white">学生</TableHead>
                              <TableHead>选择题</TableHead>
                              <TableHead>AP 分</TableHead>
                              <TableHead>得分</TableHead>
                              {mcqHeaders.map((n) => (
                                <TableHead key={`mcq-${n}`} className="px-1 text-center">{n}</TableHead>
                              ))}
                              {frqHeaders.map((n) => (
                                <TableHead key={`frq-${n}`}>Q{n}</TableHead>
                              ))}
                              <TableHead>状态</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {shownGrades.map((row) => {
                              const needsReview = (row.frqs ?? []).some((frq) => frq.needs_review);
                              return (
                              <TableRow
                                key={row.student_id}
                                className={needsReview ? "cursor-pointer bg-amber-50" : row.status === "missing" ? undefined : "cursor-pointer"}
                                onClick={() => openGrade(row)}
                              >
                                <TableCell className={cn("sticky left-0 z-10", needsReview ? "bg-amber-50" : "bg-white")}>
                                  <div className="font-medium">
                                    {row.student_name}
                                    {needsReview ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">建议复核</span> : null}
                                  </div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{row.student_id}</div>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {mcqProgressLabel(row)}
                                </TableCell>
                                <TableCell className="tabular-nums font-semibold">
                                  {apScoreText(gradeAp(row))}
                                </TableCell>
                                <TableCell className="tabular-nums">{scaledLabel(gradeAp(row), gradeMeta?.score_max)}</TableCell>
                                {mcqHeaders.map((n) => {
                                  const item = row.mcqs?.find((entry) => entry.n === n);
                                  return (
                                    <TableCell
                                      key={`${row.roster_id}-mcq-${n}`}
                                      className={cn(
                                        "px-1 text-center font-mono text-[11px]",
                                        item?.is_correct === true && "text-emerald-700",
                                        item?.is_correct === false && "text-red-600",
                                      )}
                                    >
                                      {item?.picked ?? "·"}
                                    </TableCell>
                                  );
                                })}
                                {frqHeaders.map((n) => {
                                  const frq = row.frqs?.find((entry) => entry.sort_order === n);
                                  const score = frq ? (frq.manual_score ?? frq.ai_score) : null;
                                  const label = row.status !== "submitted" || !frq
                                    ? "—"
                                    : score != null
                                      ? `${score}/${frq.max_score}`
                                      : frq.ai_failed
                                        ? "没批完"
                                        : frq.answer_text.trim() || frq.file_url
                                          ? "截止后批改"
                                          : "未作答";
                                  return (
                                    <TableCell key={`${row.roster_id}-frq-${n}`} className={cn("tabular-nums", frq?.needs_review && "bg-amber-100 font-semibold text-amber-950")} title={frq?.ai_error ?? undefined}>
                                      <div>{label}</div>
                                      {score == null && frq?.ai_error ? <div className="max-w-40 text-[10px] font-normal leading-snug text-amber-800">{frq.ai_error}</div> : null}
                                      {frq?.needs_review ? <div className="text-[10px] font-semibold text-amber-950">建议复核</div> : null}
                                    </TableCell>
                                  );
                                })}
                                <TableCell>
                                  <Pill tone={autoCollected(row, gradeMeta?.ends_at) ? "warn" : row.status === "submitted" || (row.status === "in_progress" && mcqHandedIn(row)) ? "ok" : row.status === "in_progress" ? "live" : "muted"}>
                                    {rowStatusLabel(row, gradeMeta?.ends_at)}
                                  </Pill>
                                </TableCell>
                              </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </section>
                  <p className="text-xs text-muted-foreground">绿色是选择题选对，红色是选错。点某一行打开这名学生的答卷、评语和改分。</p>
                </>
              )}
            </div>
          )}

          {page === "pdf" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">PDF 智能出题</h2>
                <p className="mt-1 text-xs text-muted-foreground">上传试卷后会自动切题，并先让 AI 审一遍。提交后由管理员决定是否放进公开模考，老师不能自己公开。</p>
              </div>
              <section className="glass max-w-3xl rounded-2xl p-5">
                <label
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/35 bg-primary/5 px-4 py-10 text-center transition hover:bg-primary/10",
                    pdfBusy && "pointer-events-none opacity-70",
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (!f || pdfBusy) return;
                    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
                      toast.error("请上传 PDF 文件");
                      return;
                    }
                    void onPdfFile(f);
                  }}
                >
                  <FileUp className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium">{pdfBusy || "选择或拖入 PDF 文件"}</span>
                  <span className="text-xs text-muted-foreground">支持官方试卷 PDF，上传后直接看切好的题目</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    disabled={!!pdfBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPdfFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="mt-3 text-[11px] text-muted-foreground">草稿只对你可见。提交给管理员后，题目会锁定。公开模考里要不要出现，由管理员决定。</p>
              </section>

              {imports.length === 0 && !activeImport ? (
                <div className="glass max-w-3xl rounded-2xl">
                  <EmptyState icon={FileUp} title="还没有 PDF 草稿" hint="上传试卷后，识别结果会保存在这里。" />
                </div>
              ) : (
                <div className="max-w-3xl space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">点开一份导入查看切题。未提交的草稿可以清掉。</p>
                    {imports.some((imp) => imp.status !== "published") && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => void deleteDraftImports()}>
                        <Trash2 className="h-3.5 w-3.5" />
                        清理未提交
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {imports.map((imp) => (
                      <div key={imp.id} className="flex items-center">
                        <Button size="sm" variant={activeImport === imp.id ? "default" : "outline"} onClick={() => void openImport(imp.id)}>
                          {importChipLabel(imp)}
                        </Button>
                        <button
                          type="button"
                          className="ml-0.5 rounded-md p-1 text-muted-foreground hover:bg-white/70 hover:text-foreground"
                          aria-label={`删除 ${importChipLabel(imp)}`}
                          onClick={() => void deleteImport(imp.id, imp.status)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeImport && (
                <div className="space-y-4">
                  <section className="glass rounded-2xl p-5">
                    <Field label="试卷标题">
                      <Input placeholder="例如：2022 AP Micro" value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} />
                    </Field>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" disabled={alreadyPublished} onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "mcq")])}>加选择题</Button>
                      <Button size="sm" variant="outline" disabled={alreadyPublished} onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "frq")])}>加大题</Button>
                      <Button size="sm" variant="outline" disabled={aiBusy || !items.length} onClick={() => void runPdfAi(activeImport, items)}>
                        {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {aiBusy ? "AI 审核中…" : "再跑一遍 AI 审核"}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!pdfBusy || aiBusy || !items.length || !pdfAiDone || alreadyPublished}
                        onClick={() => void saveAndPublish()}
                      >
                        {pdfBusy === "保存并提交到后台…" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {pdfBusy === "保存并提交到后台…" ? "提交中…" : alreadyPublished ? "已提交到后台" : "保存并提交到后台"}
                      </Button>
                    </div>
                    {alreadyPublished && (
                      <p className="mt-3 text-xs text-muted-foreground">已交给管理员审核，题目已锁定。老师不能自己把它放进公开模考。要改题请重新上传一份 PDF，避免卷库里出现重复的学校卷。</p>
                    )}
                    {aiBusy && <p className="mt-3 text-xs text-muted-foreground">AI 正在审核切题，审完后即可提交。</p>}
                    {!pdfAiDone && items.length > 0 && !aiBusy && !alreadyPublished && (
                      <p className="mt-3 text-xs text-muted-foreground">请等 AI 审完，或点「再跑一遍 AI 审核」后再提交。</p>
                    )}
                    {items.filter((it) => it.kind === "mcq" && !/^[A-E]$/.test((it.correct_answer ?? "").trim())).length > 0 && (
                      <p className="mt-3 text-xs text-amber-800">
                        还有 {items.filter((it) => it.kind === "mcq" && !/^[A-E]$/.test((it.correct_answer ?? "").trim())).length} 道选择题没设正确答案。设好之前不会显示「通过」。
                      </p>
                    )}
                    {pdfFindings.length > 0 && (
                      <p className="mt-3 text-xs text-amber-800">
                        {pdfFindings.length >= items.length
                          ? items.length === 1
                            ? "AI 标出这道题需要看一眼。改完再提交。"
                            : `AI 标出全部 ${pdfFindings.length} 道题需要看一眼。改完再提交。`
                          : `AI 标出 ${pdfFindings.length} 道题需要看一眼，另外 ${items.length - pdfFindings.length} 道没有被标出。`}
                      </p>
                    )}
                  </section>
                  {pdfNotice && (
                    <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">{pdfNotice}</p>
                  )}
                  {items.length === 0 && !pdfBusy && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">这份草稿里还没有题目。</p>
                  )}
                  {items.some((it) => frqScorePrompt(it, scoreAck[`${it.kind}-${it.sort_order}`])) ? (
                    <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      {items.flatMap((it) => {
                        const note = frqScorePrompt(it, scoreAck[`${it.kind}-${it.sort_order}`]);
                        return note ? [note] : [];
                      }).join("")}
                    </p>
                  ) : null}
                  <PdfQuestionList
                    items={items}
                    findings={pdfFindings}
                    aiRan={pdfAiRan}
                    onChange={(idx, patch) => {
                      if (typeof patch.max_score === "number") {
                        const current = items[idx];
                        if (current) setScoreAck((prev) => ({ ...prev, [`${current.kind}-${current.sort_order}`]: patch.max_score as number }));
                      }
                      setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                    }}
                    onRemove={(idx) => setItems((xs) => xs.filter((_, i) => i !== idx))}
                    onReplaceImage={(idx, file) => void replaceItemImage(idx, file)}
                    onRecrop={(idx) => void recropItem(idx)}
                    locked={alreadyPublished}
                  />
                </div>
              )}
            </div>
          )}
      </div>

      <AlertDialog open={collectTarget !== null} onOpenChange={(open) => { if (!open) setCollectTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>收这名学生的卷</AlertDialogTitle>
            <AlertDialogDescription>
              将收取「{collectTarget?.student_name ?? "这名学生"}」{collectTarget?.student_id ? `（学号 ${collectTarget.student_id}）` : ""}的答卷。收卷后不能再改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = collectTarget?.roster_id;
                if (id) void collectStudent(id);
              }}
            >
              确认收卷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={replaceRosterOpen} onOpenChange={setReplaceRosterOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖导入名册</AlertDialogTitle>
            <AlertDialogDescription>
              {unfinishedExam
                ? `「${unfinishedExam.title}」还没结束，现在不能覆盖名册。`
                : `将替换现有 ${roster.length} 名学生。原来的名册会删掉。有未结束的考试时不能覆盖。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!unfinishedExam}
              onClick={(event) => {
                if (unfinishedExam) {
                  event.preventDefault();
                  return;
                }
                void importRoster(true);
              }}
            >
              确认覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={gradeFocusId !== null} onOpenChange={(open) => { if (!open && gradeBusy && gradeBusy !== "ai") return; if (!open) setGradeFocusId(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl">
          {(() => {
            const row = gradeRows.find((item) => item.roster_id === gradeFocusId);
            if (!row) return null;
            const retryLeft = (row.frqs ?? []).filter((frq) => frqStillRetrying(frq)).length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{row.student_name} 的答卷</DialogTitle>
                  <DialogDescription>
                    {row.student_id}
                    {autoCollected(row, gradeMeta?.ends_at)
                      ? ` · 截止后自动收卷 ${beijingTime(row.submitted_at)}`
                      : row.status === "submitted" && row.submitted_at
                        ? ` · 交卷 ${beijingTime(row.submitted_at)}`
                        : ""}
                    {gradeNote ? ` · ${gradeNote}` : ""}
                    {row.status === "in_progress" ? (mcqHandedIn(row) ? " · 选择题已交，正在做大题" : " · 还在作答，下面是目前已保存的内容") : frqHeaderLabel(row)}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap justify-end gap-2">
                  {row.status === "in_progress" ? (
                    <Button variant="outline" disabled={gradeBusy !== null} onClick={() => askCollect(row.roster_id)}>
                      {gradeBusy === "collect" ? "正在收卷" : "收这名学生的卷"}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={(gradeBusy !== null && gradeBusy !== "ai") || examStillOpen} onClick={() => void gradeStudentWithAi()}>
                      {gradeBusy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {examStillOpen ? "截止后批改" : gradeBusy === "ai" ? `正在批改${retryLeft ? `，还剩 ${retryLeft} 题` : ""}` : "重试这名学生"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      gradeTicket.current += 1;
                      gradingLock.current = false;
                      setGradeBusy(null);
                      setGradeFocusId(null);
                    }}
                  >
                    关闭
                  </Button>
                </div>
                {(() => {
                  const ap = gradeAp(row);
                  return (
                    <section className="rounded-xl bg-primary/5 px-3 py-3">
                      <div className="flex gap-8">
                        <div>
                          <div className="text-xs text-muted-foreground">AP 分数</div>
                          <div className="mt-1 text-3xl font-semibold tabular-nums">{apScoreText(ap)}</div>
                        </div>
                        {gradeMeta?.score_max ? (
                          <div>
                            <div className="text-xs text-muted-foreground">得分 / {gradeMeta.score_max}</div>
                            <div className="mt-1 text-3xl font-semibold tabular-nums">{pointsOnScale(ap.composite, gradeMeta.score_max) ?? "—"}</div>
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {ap.reason === "ready"
                          ? `综合分 ${ap.composite}/${ap.compositeMax}${ap.mcqWeighted != null ? `，选择题折算 ${ap.mcqWeighted}` : ""}${ap.frqWeighted != null ? `，大题折算 ${ap.frqWeighted}` : ""}。${apBasisText(ap.basis)}`
                          : ap.reason === "frq-pending"
                            ? "大题批完后换算成 1–5。选择题占三分之二，大题占三分之一。"
                            : "交卷并出分后换算成 1–5。"}
                      </p>
                    </section>
                  );
                })()}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">选择题</h3>
                  <p className="text-xs text-muted-foreground">
                    {mcqHandedIn(row) ? (row.mcq_correct != null ? `选择题已交，得 ${row.mcq_correct}/${row.mcq_total} 分。` : "选择题已交。") : "还没交选择题，先显示目前选了的选项。"}
                    绿色是选对，红色是选错。选择题按对错计分，不能改分。
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(row.mcqs ?? []).map((item) => (
                      <span
                        key={item.n}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-xs",
                          item.is_correct === true && "bg-emerald-50 text-emerald-800",
                          item.is_correct === false && "bg-red-50 text-red-700",
                          item.picked == null && "text-muted-foreground",
                        )}
                      >
                        {item.n}.{item.picked ?? "—"}
                      </span>
                    ))}
                  </div>
                  {(row.mcqs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">这份卷没有选择题。</p> : null}
                </section>
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">大题原文</h3>
                  {(row.frqs ?? []).map((frq) => (
                    <section key={frq.frq_id} className="space-y-2 rounded-xl border border-border/70 p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-semibold">Q{frq.sort_order}{frq.title && !/^\d{1,2}[.)、]?$/.test(frq.title.trim()) ? ` · ${frq.title}` : ""}</h3>
                        <span className="text-xs text-muted-foreground">满分 {frq.max_score}</span>
                      </div>
                      <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs">{frq.answer_text.trim() || "（没有文字答案）"}</pre>
                      {frq.file_url ? (
                        <a href={frq.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">查看上传的答案</a>
                      ) : null}
                      <p className="text-sm">
                        AI 分数：{frq.ai_score == null ? (frq.ai_error || frq.ai_failed ? "没批完" : "还没有") : `${frq.ai_score}/${frq.max_score}`}
                        {frq.needs_review ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-950">建议复核</span> : null}
                      </p>
                      {frq.ai_score == null && frq.ai_error ? <p className="text-sm text-amber-800">{frq.ai_error}</p> : null}
                      {frq.ai_comment ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{frq.ai_comment}</p> : null}
                      {frq.ai_suggestions ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{frq.ai_suggestions}</p> : null}
                      {(frq.parts?.length ?? 0) >= 2 ? (
                        <div className="space-y-2">
                          {row.status === "submitted" ? (
                            <p className="text-xs text-muted-foreground">按小问改分。留空的小问继续用 AI 分数；AI 还没有的按 0 分。各小问加起来不能超过满分 {frq.max_score}。</p>
                          ) : null}
                          {frq.parts?.every((part) => part.points.length === 0) && frq.breakdown?.length ? (
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {frq.breakdown.map((point, pointIndex) => (
                                <li key={`${frq.frq_id}-flat-${pointIndex}`}>{pointLabel(point)}</li>
                              ))}
                            </ul>
                          ) : null}
                          {frq.parts?.map((part) => {
                            const cap = part.max_known ? Math.min(part.max, frq.max_score) : frq.max_score;
                            return (
                              <div key={part.key} className="space-y-1 rounded-lg bg-muted/50 p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Label htmlFor={`part-${frq.frq_id}-${part.key}`} className="w-12 shrink-0 text-xs">{part.label}</Label>
                                  {row.status === "submitted" ? (
                                    <Input
                                      id={`part-${frq.frq_id}-${part.key}`}
                                      inputMode="numeric"
                                      value={partDraft[`${frq.frq_id}:${part.key}`] ?? ""}
                                      placeholder={part.ai_earned == null ? "AI 还没有" : `AI ${part.ai_earned}`}
                                      className="h-8 max-w-28"
                                      onChange={(e) => setPartDraft((current) => ({ ...current, [`${frq.frq_id}:${part.key}`]: e.target.value }))}
                                    />
                                  ) : (
                                    <span className="text-xs tabular-nums">{part.ai_earned == null ? "还没有" : part.ai_earned}</span>
                                  )}
                                  {part.max_known ? <span className="text-xs text-muted-foreground">满分 {cap}</span> : null}
                                </div>
                                {part.points.length ? (
                                  <ul className="space-y-1 text-xs text-muted-foreground">
                                    {part.points.map((point, pointIndex) => (
                                      <li key={`${frq.frq_id}-${part.key}-${pointIndex}`}>{pointLabel(point)}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            );
                          })}
                          {row.status === "submitted" ? (
                            <p className="text-xs text-muted-foreground">
                              {(() => {
                                const pieces = frq.parts ?? [];
                                const any = pieces.some((part) => (partDraft[`${frq.frq_id}:${part.key}`] ?? "").trim() !== "");
                                if (!any) return `教师还没改这道题，目前用 AI 分数${frq.ai_score == null ? "" : ` ${frq.ai_score}/${frq.max_score}`}。`;
                                const sum = pieces.reduce((total, part) => {
                                  const value = (partDraft[`${frq.frq_id}:${part.key}`] ?? "").trim();
                                  if (!/^\d+$/.test(value)) return total + (part.ai_earned ?? 0);
                                  return total + Number(value);
                                }, 0);
                                return `教师给分合计 ${sum}/${frq.max_score}`;
                              })()}
                            </p>
                          ) : null}
                        </div>
                      ) : frq.breakdown?.length ? (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {frq.breakdown.map((point, pointIndex) => (
                            <li key={`${frq.frq_id}-${pointIndex}`}>{pointLabel(point)}</li>
                          ))}
                        </ul>
                      ) : null}
                      {row.status === "submitted" && (frq.parts?.length ?? 0) < 2 ? (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`manual-${frq.frq_id}`} className="shrink-0 text-xs">教师给分</Label>
                          <Input
                            id={`manual-${frq.frq_id}`}
                            inputMode="numeric"
                            value={manualDraft[frq.frq_id] ?? ""}
                            placeholder="留空则用 AI 分数"
                            className="max-w-40"
                            onChange={(e) => setManualDraft((current) => ({ ...current, [frq.frq_id]: e.target.value }))}
                          />
                        </div>
                      ) : null}
                      {row.status === "submitted" ? (
                        <div className="space-y-1">
                          <Label htmlFor={`comment-${frq.frq_id}`} className="text-xs">教师评语</Label>
                          <Textarea
                            id={`comment-${frq.frq_id}`}
                            value={commentDraft[frq.frq_id] ?? ""}
                            placeholder="写给这道题的批注，可以空着"
                            rows={3}
                            onChange={(e) => setCommentDraft((current) => ({ ...current, [frq.frq_id]: e.target.value }))}
                          />
                        </div>
                      ) : null}
                    </section>
                  ))}
                  {(row.frqs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">这份卷没有大题。</p> : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={gradeBusy !== null && gradeBusy !== "ai"} onClick={() => setGradeFocusId(null)}>关闭</Button>
                  {row.status === "submitted" ? (
                    <Button disabled={gradeBusy !== null || !(row.frqs ?? []).length} onClick={() => void saveManualScores()}>
                      {gradeBusy === "save" ? "正在保存" : "保存分数和评语"}
                    </Button>
                  ) : null}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={endConfirm} onOpenChange={(open) => { if (!gradeBusy) setEndConfirm(open); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>提前结束这场考试？</DialogTitle>
            <DialogDescription>正在作答的学生会马上交卷，已经保存的答案会留下来。交卷后不能再改。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={gradeBusy !== null} onClick={() => setEndConfirm(false)}>继续考试</Button>
            <Button disabled={gradeBusy !== null} onClick={() => void endExamNow()}>{gradeBusy === "end" ? "正在收卷" : "结束并收卷"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>试卷预览</DialogTitle>
            <DialogDescription>
              {source === "random"
                ? "发布时会生成一套固定随机卷：60 道选择题和 3 道大题，全班同一套，保证评分公平。"
                : selectedPaper
                  ? paperPickerLabel(selectedPaper)
                  : "请先选择一份试卷。"}
            </DialogDescription>
          </DialogHeader>
          {source === "existing" && selectedPaper && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">学生入场后会做到这一份卷。可以先打开看题面，课上仍请只用考试码入场。</p>
              <Button asChild>
                <a href={`/mock/${selectedPaper.slug}`} target="_blank" rel="noreferrer">打开试卷</a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rosterDup !== null} onOpenChange={(open) => { if (!open) setRosterDup(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>这些学号已经在名册里</DialogTitle>
            <DialogDescription>
              {rosterDup ? `${rosterDup.duplicates.length} 个学号重复：${rosterDup.duplicates.slice(0, 8).join("、")}${rosterDup.duplicates.length > 8 ? "…" : ""}。跳过会保留原来的姓名。更新会改成这份名单里的姓名。` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const choice = rosterDup;
                if (!choice) return;
                void importRoster(choice.replace, "skip", choice.rows);
              }}
            >
              跳过重复学号
            </Button>
            <Button
              type="button"
              onClick={() => {
                const choice = rosterDup;
                if (!choice) return;
                void importRoster(choice.replace, "update", choice.rows);
              }}
            >
              更新姓名
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={studentEditor !== null} onOpenChange={(open) => { if (!open) setStudentEditor(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{studentEditor?.id ? "编辑学生" : "添加学生"}</DialogTitle>
            <DialogDescription>
              {roster.find((row) => row.id === studentEditor?.id)?.id_locked
                ? "这名学生已经入场，学号不能再改。姓名还可以改。"
                : "学号在本班内不能重复。重复学号要明确选择跳过或更新，不会自动改姓名。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="student-id">学号</Label>
              <Input
                id="student-id"
                disabled={!!roster.find((row) => row.id === studentEditor?.id)?.id_locked}
                value={studentEditor?.student_id ?? ""}
                onChange={(e) => setStudentEditor((current) => current ? { ...current, student_id: e.target.value } : current)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-name">姓名</Label>
              <Input
                id="student-name"
                value={studentEditor?.student_name ?? ""}
                onChange={(e) => setStudentEditor((current) => current ? { ...current, student_name: e.target.value } : current)}
              />
            </div>
            {studentEditorError && <p className="text-sm text-destructive">{studentEditorError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setStudentEditor(null)}>取消</Button>
              <Button type="button" disabled={savingStudent} onClick={() => void saveStudent()}>
                {savingStudent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PageCropDialog
        open={!!cropPick}
        pageUrl={cropPick?.pageUrl ?? ""}
        onOpenChange={(next) => { if (!next) setCropPick(null); }}
        onConfirm={async (blob) => {
          if (!cropPick) return;
          const it = items[cropPick.index];
          if (!it) return;
          await replaceItemImage(cropPick.index, new File([blob], `${it.kind}-${it.sort_order}.png`, { type: "image/png" }));
          toast.success("已按框选范围保存图表");
        }}
      />
      {simOpen && (
        <div className="app-gradient-bg fixed inset-0 z-50 flex flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-white/60 px-4 py-3 md:px-8">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-primary">学生视角预览</p>
              <p className="truncate text-sm text-muted-foreground">不会验证考试码，也不会保存答卷</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={closeStudentSimulation}>返回教师端</Button>
          </header>
          <div className="flex flex-1 items-start justify-center overflow-auto px-4 py-8">
            {simStage === "login" && (
              <section className="glass w-full max-w-md rounded-2xl p-6">
                <h2 className="text-xl font-semibold">学生入场</h2>
                <p className="mt-1 text-sm text-muted-foreground">这里只是教师预览。正式考试请让学生打开考试入口，输入学号、姓名和考试码。</p>
                <div className="mt-5 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sim-student">学号</Label>
                    <Input id="sim-student" value={simStudentId} onChange={(e) => setSimStudentId(e.target.value)} placeholder="例如 2026001" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sim-code">考试码</Label>
                    <Input id="sim-code" value={simExamCode} onChange={(e) => setSimExamCode(e.target.value.toUpperCase())} placeholder="6 位字母和数字，如 K7PGAD" className="font-mono tracking-widest" />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (!simStudentId.trim() || !simExamCode.trim()) {
                        toast.error("请填写学号和考试码");
                        return;
                      }
                      setSimSeconds(60 * 60);
                      setSimStage("exam");
                    }}
                  >
                    进入考试
                  </Button>
                </div>
              </section>
            )}
            {simStage === "exam" && (
              <section className="glass w-full max-w-2xl rounded-2xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {assignments.find((a) => a.exam_code.toUpperCase() === simExamCode.trim().toUpperCase())?.title ?? "考试预览"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      学号 {simStudentId.trim()} · 考试码 {simExamCode.trim().toUpperCase()}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-sm text-primary">
                    {String(Math.floor(simSeconds / 60)).padStart(2, "0")}:{String(simSeconds % 60).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-5 rounded-2xl border border-white/80 bg-white/50 p-4 text-sm leading-6">
                  学生正式入场后会看到这套试卷的选择题和大题。这次预览不加载真题，输入的内容也不会提交。
                </div>
                <Textarea className="mt-4 min-h-32" placeholder="可以在这里试着写答案，关闭后不会保留" />
                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSimStage("login")}>返回入场</Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (window.confirm("这是模拟提交，不会保存答案。确定结束预览？")) setSimStage("done");
                    }}
                  >
                    模拟提交
                  </Button>
                </div>
              </section>
            )}
            {simStage === "done" && (
              <section className="glass w-full max-w-md rounded-2xl p-6 text-center">
                <h2 className="text-xl font-semibold">预览已结束</h2>
                <p className="mt-2 text-sm text-muted-foreground">没有保存任何答卷。学生仍需使用正式考试入口完成考试。</p>
                <Button className="mt-5" onClick={closeStudentSimulation}>返回教师端</Button>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
