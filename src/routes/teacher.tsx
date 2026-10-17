import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { applyKnownApAnswerKey, looksLikeProvidedFigure, parseApExamPages, readPrintedScore, studentVisibleQuestion, withUniqueQuestionNumbers, type ParsedExamItem } from "@/lib/ap-exam-parse";
import { splitTeacherFrq } from "@/lib/frq-teacher-fields";
import { cropImageBlob, cropRectsForQuestions, cropUrlFromPage } from "@/lib/exam-page-crop";
import { PageCropDialog } from "@/components/teacher/PageCropDialog";
import { PdfQuestionList, type PdfAiFinding, type TeacherPdfItem } from "@/components/teacher/PdfQuestionList";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAccountLabel } from "@/lib/display-name";

async function assertStoredImage(url: string) {
  let detail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      await res.body?.cancel();
      return;
    }
    detail = await res.text().catch(() => "");
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (detail.includes("Object not found") || detail.includes("NoSuchKey")) {
    throw new Error("页图没有写进存储（读取返回 400，文件不存在）");
  }
  throw new Error("页图读取失败");
}

async function putAssignmentPng(classId: string, importId: string, filename: string, blob: Blob) {
  const path = `assignments/${classId}/${importId}/${filename}`;
  const { error } = await supabase.storage.from("question-images").upload(path, blob, {
    contentType: blob.type || "image/png",
    upsert: true,
  });
  if (!error) {
    const url = supabase.storage.from("question-images").getPublicUrl(path).data.publicUrl;
    try {
      await assertStoredImage(url);
      return url;
    } catch {
      /* 客户端显示上传成功，但公开地址读不到时改走服务端再写一次 */
    }
  }
  const fd = new FormData();
  fd.append("file", new File([blob], filename, { type: blob.type || "image/png" }));
  fd.append("import_id", importId);
  const crop = filename.match(/^(mcq|frq)-(\d+)\.png$/i);
  if (crop) {
    fd.append("crop_kind", crop[1].toLowerCase());
    fd.append("sort_order", crop[2]);
  } else {
    const pageNumber = filename.match(/page-(\d+)/i)?.[1];
    if (!pageNumber) throw new Error(error?.message ?? "无法上传图片");
    fd.append("page_number", pageNumber);
  }
  const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || !uj.image_url) throw new Error(uj.error ?? error?.message ?? "图片上传失败");
  await assertStoredImage(uj.image_url as string);
  return uj.image_url as string;
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

export const Route = createFileRoute("/teacher")({
  head: () => ({ meta: [{ title: "教师端 · 学校考试" }, { name: "robots", content: "noindex" }] }),
  component: TeacherHome,
});

type RosterRow = { id: string; student_id: string; student_name: string; user_id: string | null; account_name?: string | null };
type Paper = { id: string; slug: string; title: string; year: number | null; created_at?: string | null };
type Assignment = {
  id: string;
  title: string;
  exam_code: string;
  starts_at: string;
  ends_at: string;
  results_published: boolean;
  paper_id: string;
  paper: { id: string; slug: string; title: string } | null;
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
  ai_comment: string | null;
  ai_suggestions: string | null;
  breakdown: { point: string; awarded: boolean; comment: string }[];
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
  frq_answers: Record<string, { text?: string; fileUrl?: string | null }>;
  mcqs: GradeMcq[];
  frqs: GradeFrq[];
  frq_score: number | null;
  frq_max: number;
};
type PdfImport = { id: string; filename: string; page_count: number; status: string; paper_id: string | null; created_at: string };
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

function beijingTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

type TeacherPage = "overview" | "roster" | "exam" | "scores" | "pdf";

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
  const res = await fetch(url, { cache: "no-store" });
  await res.body?.cancel();
  return res.ok;
}

function sortPdfItems(items: PdfItem[]) {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "mcq" ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

function paperPickerLabel(p: Paper) {
  if (p.slug.startsWith("school-")) {
    const day = p.created_at
      ? new Date(p.created_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
      : "";
    return `${p.title} · 本校导入${day ? ` ${day}` : ""}`;
  }
  return p.year ? `${p.title} · ${p.year}` : p.title;
}

function importChipLabel(imp: PdfImport) {
  const when = imp.created_at
    ? new Date(imp.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const status = imp.status === "published" ? "已提交" : imp.status === "rendered" ? "未提交" : imp.status;
  return `${imp.filename.replace(/\.pdf$/i, "")} · ${status}${when ? ` · ${when}` : ""} · ${imp.id.slice(0, 4)}`;
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
    max_score: kind === "mcq" ? 1 : 9,
    reviewed: false,
    rubric_note: "",
  };
}

function TeacherHome() {
  const { user, loading: authLoading, signOut } = useAuth();
  const accountLabel = useAccountLabel("教师");
  const [denied, setDenied] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [csvText, setCsvText] = useState("学号,姓名\n");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"existing" | "random">("existing");
  const [paperId, setPaperId] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [examMinutes, setExamMinutes] = useState(70);
  const [publishAnswers, setPublishAnswers] = useState(false);
  const [aiGradeFrq, setAiGradeFrq] = useState(true);
  const [cropPick, setCropPick] = useState<{ index: number; pageUrl: string } | null>(null);
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 70 * 60 * 1000)));
  const [creating, setCreating] = useState(false);
  const [gradeId, setGradeId] = useState("");
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([]);
  const [gradeFocusId, setGradeFocusId] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, string>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [gradeBusy, setGradeBusy] = useState<"save" | "ai" | "collect" | "end" | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [gradeMeta, setGradeMeta] = useState<{ title: string; results_published: boolean; ends_at: string; ai_grade: boolean } | null>(null);
  const [gradeNote, setGradeNote] = useState("");
  const gradingLock = useRef(false);
  const autoQueued = useRef("");
  const gradeTicket = useRef(0);
  const gradeNotice = useRef("");
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
  const [page, setPage] = useState<TeacherPage>("overview");
  const [examStep, setExamStep] = useState<"edit" | "review" | "done">("edit");
  const [publishedExam, setPublishedExam] = useState<{ title: string; code: string } | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [scoreQuery, setScoreQuery] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ id: string; rows: GradeRow[] } | null>(null);
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
    if (a.ok) setAssignments((await a.json()).assignments ?? []);
    if (p.ok) setPapers((await p.json()).papers ?? []);
  }, []);

  const loadPdfs = useCallback(async () => {
    const r = await authFetch("/api/teacher/pdf");
    if (r.ok) setImports((await r.json()).imports ?? []);
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadClass().then(() => Promise.all([loadAssignments(), loadPdfs()]));
  }, [authLoading, user, loadClass, loadAssignments, loadPdfs]);

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

  async function importRoster(replace: boolean) {
    if (replace && !window.confirm("覆盖会删除现有花名册。有未结束的考试时系统会拒绝覆盖。确定继续？")) {
      return;
    }
    const rows = parseRosterCsv(csvText);
    if (rows.length === 0) {
      toast.error("没有读到学号/姓名");
      return;
    }
    const r = await authFetch("/api/teacher/class", {
      method: "POST",
      body: JSON.stringify({ rows, replace }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "导入失败");
      return;
    }
    setRoster(j.roster ?? []);
    toast.success(`花名册 ${j.roster?.length ?? 0} 人`);
  }

  async function importTestRoster() {
    const r = await authFetch("/api/teacher/class", {
      method: "POST",
      body: JSON.stringify({ rows: TEST_ROSTER, replace: false }),
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
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
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
        toast.message("答案开关已保存。这份卷没能记下 AI 批改，交卷后不会自动批大题。");
      }
      toast.success(`考试码 ${j.assignment.exam_code} 已复制`);
      setPublishedExam({ title, code: j.assignment.exam_code });
      setTitle("");
      setExamStep("done");
      await loadAssignments();
      setGradeId(j.assignment.id);
      setPage("exam");
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
    if (!opts?.keepPage) setPage("scores");
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
          })),
    );
    setGradeMeta({
      title: j.assignment.title,
      results_published: j.assignment.results_published,
      ends_at: j.assignment.ends_at,
      ai_grade: j.assignment.ai_grade !== false,
    });
    return rows;
  }

  function openGrade(row: GradeRow) {
    if (row.status === "missing") {
      toast.message("这名学生还没开始作答");
      return;
    }
    setGradeFocusId(row.roster_id);
    const draft: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const frq of row.frqs ?? []) {
      draft[frq.frq_id] = frq.manual_score == null ? "" : String(frq.manual_score);
      notes[frq.frq_id] = frq.manual_comment ?? "";
    }
    setManualDraft(draft);
    setCommentDraft(notes);
  }

  async function saveManualScores() {
    const row = gradeRows.find((r) => r.roster_id === gradeFocusId);
    if (!gradeId || !row) return;
    const manual: Record<string, number | null> = {};
    const comments: Record<string, string | null> = {};
    for (const frq of row.frqs ?? []) {
      const raw = (manualDraft[frq.frq_id] ?? "").trim();
      const note = (commentDraft[frq.frq_id] ?? "").trim();
      if (note.length > 2000) {
        toast.error(`第 ${frq.sort_order} 题的评语不超过 2000 字`);
        return;
      }
      comments[frq.frq_id] = note || null;
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
        body: JSON.stringify({ assignment_id: gradeId, roster_id: row.roster_id, manual, comments }),
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
    return rows.filter((row) => row.status === "submitted" && (row.frqs ?? []).some((frq) => frq.ai_score == null && !frq.ai_failed && (frq.answer_text.trim() || frq.file_url)));
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
    try {
      for (const rosterId of rosterIds) {
        let busyWaits = 0;
        for (let step = 0; step < 8; step++) {
          if (gradeTicket.current !== ticket) return;
          let response: Response;
          try {
            response = await authFetch("/api/teacher/gradebook", {
              method: "POST",
              signal: AbortSignal.timeout(38000),
              body: JSON.stringify({ assignment_id: gradeId, roster_id: rosterId, action: "ai" }),
            });
          } catch {
            toast.error("批改请求中断了。已经批完的题目已保存，再点一次会继续。");
            failed = true;
            break;
          }
          const body = (await response.json().catch(() => null)) as { error?: string; done?: boolean; pending?: number; busy?: boolean; graded_sort?: number | null } | null;
          if (gradeTicket.current !== ticket) return;
          await loadGradebook(gradeId, { keepPage: true });
          if (!body) {
            toast.error("批改请求中断了。已经批完的题目已保存，再点一次会继续。");
            failed = true;
            break;
          }
          if (body.busy) {
            busyWaits += 1;
            if (busyWaits > 8) {
              toast.message("另一边正在批改这名学生，请稍后再试");
              failed = true;
              break;
            }
            setGradeNote("另一边正在批这一题，稍等后继续");
            await new Promise((resolve) => window.setTimeout(resolve, 2500));
            step -= 1;
            continue;
          }
          busyWaits = 0;
          if (!response.ok) {
            toast.error(body.error ?? "这一题没批完。已经批完的题目已保存，再点一次会继续。");
            failed = true;
            break;
          }
          if (body.done || body.pending === 0) break;
          setGradeNote(body.graded_sort ? `第 ${body.graded_sort} 题已写入，还剩 ${body.pending} 题` : `还剩 ${body.pending} 题`);
        }
        if (failed) break;
      }
      if (!failed && gradeTicket.current === ticket) {
        setGradeNote("");
        toast.success("AI 批改已写入");
      }
    } finally {
      if (autoQueued.current === `${gradeId}:${ticket}`) {
        gradingLock.current = false;
        setGradeBusy(null);
      }
    }
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
    if (!classGradeDue) return;
    setGradeNote("考试已结束，正在批改全班大题");
    const kickClassGrade = () => {
      void authFetch("/api/teacher/gradebook", {
        method: "POST",
        body: JSON.stringify({ assignment_id: gradeId, action: "batch" }),
      }).then(async (response) => {
        const body = await response.json().catch(() => ({} as { notice?: string; error?: string }));
        const message = body.notice || (!response.ok ? body.error : "");
        if (!message || message === gradeNotice.current) return;
        gradeNotice.current = message;
        toast.error(message);
      }).catch(() => undefined);
    };
    kickClassGrade();
    const timer = window.setInterval(() => {
      kickClassGrade();
      void loadGradebook(gradeId, { keepPage: true });
    }, 8000);
    return () => {
      window.clearInterval(timer);
      setGradeNote("");
    };
    // Refresh the roster while the server finishes the class. Opening this page is only a backup if nobody was online at the deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classGradeDue, gradeId]);

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
    const header = ["学号", "姓名", "状态", "选择题得分", "选择题满分", "总分", "选择题作答", ...frqHeaders, "交卷时间（北京时间）"];
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
      return [
        row.student_id,
        row.student_name,
        row.status === "submitted" ? "已交卷" : row.status === "in_progress" ? "作答中" : "未交",
        row.mcq_correct ?? "",
        row.mcq_total ?? "",
        total,
        mcqText,
        ...frqCells,
        beijingTime(row.submitted_at),
      ].map(csvCell);
    });
    downloadText(`${gradeMeta?.title ?? "gradebook"}.csv`, `\uFEFF${[header.map(csvCell).join(","), ...lines.map((line) => line.join(","))].join("\n")}`);
  }

  async function collectStudent(rosterId: string) {
    if (!gradeId) return;
    const student = gradeRows.find((item) => item.roster_id === rosterId);
    if (!window.confirm(`确定收「${student?.student_name ?? "这名学生"}」的卷吗？收卷后不能再改。`)) return;
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
      const opened = await openImport(importId);
      await loadPdfs();
      let parsed = applyKnownApAnswerKey(
        parseApExamPages(
          raster.map((page) => ({ page_number: page.page_number, extracted_text: page.extracted_text })),
        ),
        file.name,
      );
      let visionError = "";
      if (parsed.length === 0) {
        setPdfBusy("文字对不上官方试卷格式，正在让 AI 看页图…");
        const vision = await requestVisionParse(importId, raster);
        parsed = applyKnownApAnswerKey(vision.items, file.name);
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
            stem: it.kind === "frq" ? studentVisibleQuestion(it.stem, pageText) || visible.slice(0, 80) : it.stem,
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
            image_url: crop,
            page_image_url: pageUrl,
          };
        });
        setItems(withUniqueQuestionNumbers(nextItems));
        const mcq = parsed.filter((it) => it.kind === "mcq").length;
        const frq = parsed.filter((it) => it.kind === "frq").length;
        const storageNote = storageNotes.length ? `页图没有保存：${storageNotes.join("；")}。` : "";
        if (storageNote) setPdfNotice(storageNote);
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
        await runPdfAi(importId, nextItems);
      } else {
        const storageNote = storageNotes.length ? `页图也没保存：${storageNotes.join("；")}。` : "";
        const msg = `${visionError || "没有切出题目。这份 PDF 的文字对不上官方试卷的「1. (A)(B)(C)(D)」格式，AI 也没有从页图里认出完整题目。"} ${storageNote}草稿已留下，可以手工加题。`.trim();
        setPdfNotice(msg);
        setItems([]);
        toast.error("没有切出题目");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF 处理失败");
    } finally {
      setPdfBusy("");
    }
  }

  async function openImport(id: string): Promise<{ pages: PdfPage[] } | null> {
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
        const storedScore = Number(it.max_score) || (it.kind === "mcq" ? 1 : 9);
        const max_score = printed && (it.kind === "frq" ? storedScore === 9 : storedScore === 1) ? printed : storedScore;
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
    setItems(withUniqueQuestionNumbers(applied));
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
      setPage("exam");
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

  useEffect(() => {
    if (page !== "scores" || gradeId || assignments.length === 0) return;
    void loadGradebook(assignments[0].id);
  }, [page, gradeId, assignments]);

  useEffect(() => {
    if (paperId) return;
    const first = libraryPapers[0];
    if (first) setPaperId(first.id);
  }, [libraryPapers, paperId]);

  useEffect(() => {
    const id = assignments[0]?.id;
    if (!id) {
      setSnapshot(null);
      return;
    }
    let cancel = false;
    void authFetch(`/api/teacher/gradebook?assignment_id=${id}`).then(async (r) => {
      if (!r.ok || cancel) return;
      const j = await r.json();
      if (!cancel) setSnapshot({ id, rows: j.rows ?? [] });
    });
    return () => {
      cancel = true;
    };
  }, [assignments]);

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
            <Link to="/">返回首页</Link>
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
              <Link to="/">返回首页</Link>
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
            <Link to="/">返回首页</Link>
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
  const liveCount = assignments.filter((a) => examWindow(a.starts_at, a.ends_at).label === "进行中").length;
  const overviewRate = mcqRate(snapshot?.rows ?? []);
  const pendingCount = snapshot ? snapshot.rows.filter((r) => r.status !== "submitted").length : 0;
  const gradeRate = mcqRate(gradeRows);
  const frqCount = gradeRows.filter((r) => r.status === "submitted" && Object.keys(r.frq_answers ?? {}).length > 0).length;
  const bestScore = gradeRows.reduce((best, row) => {
    if (row.mcq_correct == null || !row.mcq_total) return best;
    return Math.max(best, row.mcq_correct / row.mcq_total);
  }, -1);
  const examStillOpen = !!gradeMeta && Date.parse(gradeMeta.ends_at) > Date.now();
  const mcqHeaders = columnNumbers(gradeRows, (row) => row.mcqs, (item) => item.n);
  const frqHeaders = columnNumbers(gradeRows, (row) => row.frqs, (frq) => frq.sort_order);
  const frqWaiting = gradeRows.some((row) => row.status === "submitted" && (row.frqs ?? []).some((frq) => (frq.answer_text.trim() || frq.file_url) && frq.manual_score == null && frq.ai_score == null));
  const publishBlock = !gradeMeta
    ? ""
    : examStillOpen
      ? "考试还在进行，先不要公布"
      : inProgressCount > 0
        ? "还有学生在作答，收卷后才能公布"
        : frqWaiting
          ? "大题还没有分数，批完再公布"
          : "";
  const paperLabel = source === "random"
    ? "固定随机卷（60 道选择题 + 3 道大题）"
    : selectedPaper
      ? paperPickerLabel(selectedPaper)
      : "未选择";

  function go(next: TeacherPage) {
    setPage(next);
    if (next === "exam" && examStep === "edit" && !title.trim()) {
      const start = new Date();
      setStartsAt(toLocalInput(start));
      setExamMinutes(70);
      setEndsAt(toLocalInput(new Date(start.getTime() + 70 * 60 * 1000)));
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
    const starts = Date.parse(startsAt);
    const ends = Date.parse(endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
      toast.error("请设置有效的开考和截止时间");
      return;
    }
    if (examMinutes < 10 || examMinutes > 240) {
      toast.error("答题时长请设在 10 到 240 分钟之间");
      return;
    }
    setExamStep("review");
  }

  function submitProgress(id: string) {
    if (snapshot?.id !== id || snapshot.rows.length === 0) return "—";
    const done = snapshot.rows.filter((r) => r.status === "submitted").length;
    return `${done} / ${snapshot.rows.length}`;
  }

  return (
    <div className="teacher-console flex min-h-screen flex-col">
      <header className="border-b border-white/60 px-4 py-3 md:px-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                返回
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
              <p className="mt-1 text-sm text-muted-foreground">{copy[2]}</p>
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
                <StatCard label="平均正确率" value={overviewRate == null ? "—" : `${overviewRate}%`} hint={overviewRate == null ? "暂无成绩数据" : "最近一场已交卷的选择题"} icon={BarChart3} />
                <StatCard label="待处理" value={pendingCount} hint={snapshot ? "最近一场尚未交卷" : "暂无待处理事项"} icon={Clock} />
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
                    完成名册导入后，即可开始布置考试并查看成绩。
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
                {assignments.length === 0 ? (
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
                          <TableHead>状态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.slice(0, 6).map((a) => {
                          const win = examWindow(a.starts_at, a.ends_at);
                          return (
                            <TableRow key={a.id} className="cursor-pointer" onClick={() => void loadGradebook(a.id)}>
                              <TableCell className="font-medium">{a.title}</TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.ends_at).toLocaleString()}</TableCell>
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
                              <TableCell>{submitProgress(a.id)}</TableCell>
                              <TableCell>{snapshot?.id === a.id && overviewRate != null ? `${overviewRate}%` : "—"}</TableCell>
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
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => void importRoster(false)}>追加导入</Button>
                  <Button type="button" variant="outline" onClick={() => void importTestRoster()}>导入测试学号</Button>
                  <Button variant="outline" onClick={() => void importRoster(true)}>覆盖导入</Button>
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
              <div>
                <h2 className="text-lg font-semibold">布置一场考试</h2>
                <p className="mt-1 text-xs text-muted-foreground">设置考试信息，确认后即可生成学生考试码。</p>
              </div>
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
                        <dt className="text-muted-foreground">答题时长</dt>
                        <dd className="font-medium">{examMinutes} 分钟</dd>
                        <dt className="text-muted-foreground">考试时间</dt>
                        <dd className="font-medium">{new Date(startsAt).toLocaleString()} 至 {new Date(endsAt).toLocaleString()}</dd>
                        <dt className="text-muted-foreground">防作弊</dt>
                        <dd className="font-medium">离开页面会提醒，关闭页面前会再确认一次</dd>
                        <dt className="text-muted-foreground">公布答案</dt>
                        <dd className="font-medium">{publishAnswers ? "交卷后公布答案和解析" : "交卷后不公布，之后可在成绩册公布"}</dd>
                        <dt className="text-muted-foreground">AI 批改</dt>
                        <dd className="font-medium">{aiGradeFrq ? "交卷后用 AI 批改大题" : "只收答卷，不自动批大题"}</dd>
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
                          onClick={() => setSource("random")}
                        >
                          生成固定随机卷
                        </button>
                      </div>
                    </Field>
                    {source === "existing" ? (
                      <Field label="选择试卷" hint="选择已有题卷，学生将完成同一套题目。">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Select value={paperId || undefined} onValueChange={setPaperId}>
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
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="开始时间">
                        <Input
                          type="datetime-local"
                          className="min-w-0 w-full text-sm"
                          value={startsAt}
                          onChange={(e) => {
                            const value = e.target.value;
                            setStartsAt(value);
                            const start = Date.parse(value);
                            if (Number.isFinite(start)) setEndsAt(toLocalInput(new Date(start + examMinutes * 60 * 1000)));
                          }}
                        />
                      </Field>
                      <Field label="答题时长（分钟）" hint="改时长会重算截止时间。">
                        <Input
                          type="number"
                          min={10}
                          max={240}
                          value={examMinutes}
                          onChange={(e) => {
                            const mins = Number(e.target.value);
                            if (!Number.isFinite(mins)) return;
                            setExamMinutes(mins);
                            if (mins < 10 || mins > 240) return;
                            const start = Date.parse(startsAt);
                            if (Number.isFinite(start)) setEndsAt(toLocalInput(new Date(start + mins * 60 * 1000)));
                          }}
                        />
                      </Field>
                      <Field label="截止时间">
                        <Input
                          type="datetime-local"
                          className="min-w-0 w-full text-sm"
                          value={endsAt}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEndsAt(value);
                            const start = Date.parse(startsAt);
                            const end = Date.parse(value);
                            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                              setExamMinutes(Math.max(1, Math.round((end - start) / 60000)));
                            }
                          }}
                        />
                      </Field>
                    </div>
                    <ul className="list-disc space-y-1 rounded-xl bg-amber-500/10 px-6 py-2 text-xs leading-relaxed text-amber-900">
                      <li>学生用学号、姓名和考试码进入。考试码是 6 位字母和数字，例如 K7PGAD。</li>
                      <li>倒计时到统一截止时间。开始得晚，剩下的时间就更短。</li>
                      <li>离开考试页面会提醒，关闭页面前会再确认一次。</li>
                      <li>未交卷可以在截止前重新进入。已提交的答卷不能重复提交。</li>
                      <li>选择题交卷后不能再改。</li>
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
                {assignments.length === 0 ? (
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
                          {a.paper?.title ?? "试卷"} · {new Date(a.starts_at).toLocaleString()} – {new Date(a.ends_at).toLocaleString()}
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
                  <p className="mt-1 text-xs text-muted-foreground">先看全班成绩。考试截止后会自动批完全部大题，点某一行再看这名学生的答卷。</p>
                  {gradeNote ? <p className="mt-1 text-sm text-muted-foreground">{gradeNote}</p> : null}
                </div>
                <Button variant="outline" disabled={!gradeRows.length} onClick={exportCsv}>导出成绩</Button>
              </div>
              {assignments.length === 0 ? (
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
                          <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
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
                    <StatCard label="班级正确率" value={gradeRate == null ? "—" : `${gradeRate}%`} hint={gradeRate == null ? "暂无成绩数据" : "已交卷选择题"} />
                    <StatCard
                      label="已提交"
                      value={gradeId ? `${submittedCount} / ${gradeRows.length || roster.length}` : roster.length ? `0 / ${roster.length}` : "—"}
                      hint={gradeId ? `${inProgressCount} 人作答中` : roster.length ? "名册人数，选择考试后显示交卷数" : "请选择一场考试"}
                    />
                    <StatCard label="最高正确率" value={bestScore < 0 ? "—" : `${Math.round(bestScore * 100)}%`} hint={bestScore < 0 ? "暂无成绩数据" : "单份已交答卷"} />
                    <StatCard label="已交大题" value={frqCount} hint={frqCount ? "点学生姓名查看评语和改分" : "暂无大题作答"} />
                  </div>
                  <section className="glass overflow-hidden rounded-2xl">
                    <div className="px-5 py-4">
                      <h2 className="text-[15px] font-semibold">成绩花名册</h2>
                      <p className="text-xs text-muted-foreground">{gradeMeta ? `${gradeMeta.title} · 点一行查看答卷` : "选择考试后显示全班成绩"}</p>
                    </div>
                    {!gradeId ? (
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
                            {shownGrades.map((row) => (
                              <TableRow
                                key={row.student_id}
                                className={row.status === "missing" ? undefined : "cursor-pointer"}
                                onClick={() => openGrade(row)}
                              >
                                <TableCell className="sticky left-0 z-10 bg-white">
                                  <div className="font-medium">{row.student_name}</div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{row.student_id}</div>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {row.status === "in_progress" ? "作答中" : row.mcq_correct != null ? `${row.mcq_correct}/${row.mcq_total}` : "—"}
                                </TableCell>
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
                                        ? "未完成"
                                        : frq.answer_text.trim() || frq.file_url
                                          ? "批改中"
                                          : "未作答";
                                  return (
                                    <TableCell key={`${row.roster_id}-frq-${n}`} className="tabular-nums" title={frq?.ai_error ?? undefined}>{label}</TableCell>
                                  );
                                })}
                                <TableCell>
                                  <Pill tone={row.status === "submitted" ? "ok" : row.status === "in_progress" ? "live" : "muted"}>
                                    {row.status === "submitted" ? "已交" : row.status === "in_progress" ? "作答中" : "未交"}
                                  </Pill>
                                </TableCell>
                              </TableRow>
                            ))}
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
                <p className="mt-1 text-xs text-muted-foreground">上传试卷后会自动切题，并先让 AI 审一遍。确认后提交到后台，再去布置考试。</p>
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
                <p className="mt-3 text-[11px] text-muted-foreground">草稿只对你可见。是否进入模拟考试或练习库，由管理员决定。</p>
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
                      <Button size="sm" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "mcq")])}>加选择题</Button>
                      <Button size="sm" variant="outline" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "frq")])}>加大题</Button>
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
                      <p className="mt-3 text-xs text-muted-foreground">这份卷已经提交。改题请重新上传 PDF，不要在这里再点提交，以免卷库里出现重复的学校卷。</p>
                    )}
                    {aiBusy && <p className="mt-3 text-xs text-muted-foreground">AI 正在审核切题，审完后即可提交。</p>}
                    {!pdfAiDone && items.length > 0 && !aiBusy && !alreadyPublished && (
                      <p className="mt-3 text-xs text-muted-foreground">请等 AI 审完，或点「再跑一遍 AI 审核」后再提交。</p>
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
                  {items.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">这份草稿里还没有题目。</p>
                  )}
                  {items.some((it) => it.kind === "frq" && (it.max_score <= 1 || readPrintedScore(`${it.stem} ${it.content}`, 0) === 0) && scoreAck[`${it.kind}-${it.sort_order}`] !== it.max_score) ? (
                    <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      {items.filter((it) => it.kind === "frq" && (it.max_score <= 1 || readPrintedScore(`${it.stem} ${it.content}`, 0) === 0) && scoreAck[`${it.kind}-${it.sort_order}`] !== it.max_score).map((it) => (
                        it.max_score <= 1 ? `Q${it.sort_order} 满分只有 ${it.max_score || 1} 分，请确认。` : `Q${it.sort_order} 没有认出卷面分值，请确认满分。`
                      )).join("")}
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
                  />
                </div>
              )}
            </div>
          )}
      </div>

      <Dialog open={gradeFocusId !== null} onOpenChange={(open) => { if (!open && !gradeBusy) setGradeFocusId(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl">
          {(() => {
            const row = gradeRows.find((item) => item.roster_id === gradeFocusId);
            if (!row) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{row.student_name} 的答卷</DialogTitle>
                  <DialogDescription>
                    {row.student_id}
                    {row.status === "submitted" && row.submitted_at ? ` · 交卷 ${beijingTime(row.submitted_at)}` : ""}
                    {gradeNote ? ` · ${gradeNote}` : ""}
                    {row.status === "in_progress" ? " · 还在作答，下面是目前已保存的内容" : row.frq_score == null ? " · 大题还没有分数" : ` · 大题 ${row.frq_score}/${row.frq_max}`}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap justify-end gap-2">
                  {row.status === "in_progress" ? (
                    <Button variant="outline" disabled={gradeBusy !== null} onClick={() => void collectStudent(row.roster_id)}>
                      {gradeBusy === "collect" ? "正在收卷" : "收这名学生的卷"}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={gradeBusy !== null || examStillOpen} onClick={() => void gradeStudentWithAi()}>
                      {gradeBusy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {examStillOpen ? "结束后自动批改" : gradeBusy === "ai" ? "正在重试" : "重试这名学生"}
                    </Button>
                  )}
                </div>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">选择题</h3>
                  <p className="text-xs text-muted-foreground">
                    {row.mcq_correct != null ? `得 ${row.mcq_correct}/${row.mcq_total} 分。` : "还没交卷，先显示目前选了的选项。"}
                    绿色是选对，红色是选错。
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
                        <h3 className="text-sm font-semibold">Q{frq.sort_order}{frq.title ? ` · ${frq.title}` : ""}</h3>
                        <span className="text-xs text-muted-foreground">满分 {frq.max_score}</span>
                      </div>
                      <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs">{frq.answer_text.trim() || "（没有文字答案）"}</pre>
                      {frq.file_url ? (
                        <a href={frq.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">查看上传的答案</a>
                      ) : null}
                      <p className="text-sm">
                        AI 分数：{frq.ai_score == null ? (frq.ai_failed ? "没批完" : "还没有") : `${frq.ai_score}/${frq.max_score}`}
                      </p>
                      {frq.ai_failed && frq.ai_error ? <p className="text-sm text-amber-800">{frq.ai_error}</p> : null}
                      {frq.ai_comment ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{frq.ai_comment}</p> : null}
                      {frq.ai_suggestions ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{frq.ai_suggestions}</p> : null}
                      {frq.breakdown?.length ? (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {frq.breakdown.map((point, pointIndex) => (
                            <li key={`${frq.frq_id}-${pointIndex}`}>{point.awarded ? "得分" : "未得分"} · {point.point}{point.comment ? `：${point.comment}` : ""}</li>
                          ))}
                        </ul>
                      ) : null}
                      {row.status === "submitted" ? (
                        <div className="space-y-2">
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
                        </div>
                      ) : null}
                    </section>
                  ))}
                  {(row.frqs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">这份卷没有大题。</p> : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={gradeBusy !== null} onClick={() => setGradeFocusId(null)}>关闭</Button>
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

      <Dialog open={studentEditor !== null} onOpenChange={(open) => { if (!open) setStudentEditor(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{studentEditor?.id ? "编辑学生" : "添加学生"}</DialogTitle>
            <DialogDescription>学号在本班内不能重复。已有考试记录的学生不能从名册删除。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="student-id">学号</Label>
              <Input
                id="student-id"
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
