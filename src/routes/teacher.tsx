import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { applyKnownApAnswerKey, looksLikeProvidedFigure, parseApExamPages } from "@/lib/ap-exam-parse";
import { cropFigureFromExamPage, cropImageBlob, cropRectsForQuestions, cropUrlFromPage, refineFigureBlob } from "@/lib/exam-page-crop";
import { PdfQuestionList, type PdfAiFinding, type TeacherPdfItem } from "@/components/teacher/PdfQuestionList";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

async function putAssignmentPng(classId: string, importId: string, filename: string, blob: Blob) {
  const path = `assignments/${classId}/${importId}/${filename}`;
  const { error } = await supabase.storage.from("question-images").upload(path, blob, {
    contentType: "image/png",
    upsert: true,
  });
  if (!error) return supabase.storage.from("question-images").getPublicUrl(path).data.publicUrl;
  const crop = filename.match(/^(mcq|frq)-(\d+)\.png$/i);
  if (!crop) throw new Error(error.message);
  const fd = new FormData();
  fd.append("file", new File([blob], filename, { type: "image/png" }));
  fd.append("import_id", importId);
  fd.append("crop_kind", crop[1].toLowerCase());
  fd.append("sort_order", crop[2]);
  const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || !uj.image_url) throw new Error(uj.error ?? error.message);
  return uj.image_url as string;
}

export const Route = createFileRoute("/teacher")({
  head: () => ({ meta: [{ title: "教师端 · 学校考试" }, { name: "robots", content: "noindex" }] }),
  component: TeacherHome,
});

type RosterRow = { id: string; student_id: string; student_name: string; user_id: string | null };
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
type GradeRow = {
  student_id: string;
  student_name: string;
  status: string;
  submitted_at: string | null;
  mcq_correct: number | null;
  mcq_total: number | null;
  frq_answers: Record<string, { text?: string; fileUrl?: string | null }>;
};
type PdfImport = { id: string; filename: string; page_count: number; status: string; paper_id: string | null; created_at: string };
type PdfPage = { id: string; page_number: number; image_url: string; extracted_text: string | null };
type PdfItem = TeacherPdfItem;

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
  return !!url && /\/page-\d+\.(png|jpe?g|webp)$/i.test(url);
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
  const day = imp.created_at
    ? new Date(imp.created_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
    : "";
  const status = imp.status === "published" ? "已提交" : imp.status === "rendered" ? "未提交" : imp.status;
  return `${imp.filename.replace(/\.pdf$/i, "")} · ${status}${day ? ` · ${day}` : ""}`;
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
    max_score: 9,
    reviewed: false,
  };
}

function TeacherHome() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [denied, setDenied] = useState(false);
  const [ready, setReady] = useState(false);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [csvText, setCsvText] = useState("学号,姓名\n");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"existing" | "random">("existing");
  const [paperId, setPaperId] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [creating, setCreating] = useState(false);
  const [gradeId, setGradeId] = useState("");
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([]);
  const [gradeMeta, setGradeMeta] = useState<{ title: string; results_published: boolean } | null>(null);
  const [imports, setImports] = useState<PdfImport[]>([]);
  const [activeImport, setActiveImport] = useState<string>("");
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [items, setItems] = useState<PdfItem[]>([]);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfBusy, setPdfBusy] = useState("");
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

  const loadClass = useCallback(async () => {
    const r = await authFetch("/api/teacher/class");
    if (r.status === 401) {
      setDenied(true);
      return;
    }
    const j = await r.json();
    setRoster(j.roster ?? []);
    setDenied(false);
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
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? "布置失败");
        return;
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

  async function loadGradebook(id: string) {
    setGradeId(id);
    setPage("scores");
    const r = await authFetch(`/api/teacher/gradebook?assignment_id=${id}`);
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "无法加载成绩册");
      return;
    }
    setGradeRows(j.rows ?? []);
    setGradeMeta({ title: j.assignment.title, results_published: j.assignment.results_published });
  }

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
    const header = "学号,姓名,状态,MCQ正确,MCQ总分,交卷时间";
    const lines = gradeRows.map((row) =>
      [row.student_id, row.student_name, row.status, row.mcq_correct ?? "", row.mcq_total ?? "", row.submitted_at ?? ""].join(","),
    );
    downloadText(`${gradeMeta?.title ?? "gradebook"}.csv`, [header, ...lines].join("\n"));
  }

  async function runPdfAi(importId: string, current: PdfItem[]) {
    setAiBusy(true);
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
      const findings = (j.findings ?? []) as PdfAiFinding[];
      setPdfFindings(findings);
      setPdfAiRan(true);
      setPdfAiDone(true);
      if (findings.length === 0) {
        toast.success("AI 没有发现明显切题问题，可以直接提交。有需要再点编辑。");
      } else {
        toast.message(`AI 标出 ${findings.length} 道需要看一眼的题，其余不用逐题勾选。`);
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

  async function onPdfFile(file: File) {
    setPdfBusy("正在把每一页渲染成图片…");
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
      for (const page of raster) {
        setPdfBusy(`上传第 ${page.page_number} 页…`);
        let imageUrl = "";
        let clientErr = "";
        if (classId) {
          try {
            imageUrl = await putAssignmentPng(classId, importId, `page-${page.page_number}.png`, page.blob);
          } catch (e) {
            clientErr = e instanceof Error ? e.message : "存储失败";
          }
        }
        if (imageUrl) {
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
            throw new Error(rj.error ?? `第 ${page.page_number} 页记录失败`);
          }
        } else {
          const fd = new FormData();
          fd.append("file", new File([page.blob], `page-${page.page_number}.png`, { type: "image/png" }));
          fd.append("import_id", importId);
          fd.append("page_number", String(page.page_number));
          fd.append("extracted_text", page.extracted_text);
          const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
          if (!up.ok) {
            const uj = await up.json().catch(() => ({}));
            throw new Error(uj.error ?? clientErr ?? `第 ${page.page_number} 页上传失败`);
          }
        }
      }
      const opened = await openImport(importId);
      await loadPdfs();
      const parsed = applyKnownApAnswerKey(
        parseApExamPages(
          raster.map((page) => ({ page_number: page.page_number, extracted_text: page.extracted_text })),
        ),
        file.name,
      );
      if (parsed.length > 0) {
        const rects = cropRectsForQuestions(raster, parsed);
        const imageByKey: Record<string, string> = {};
        let cropFails = 0;
        let figures = 0;
        for (const it of parsed) {
          if (!it.needs_image) continue;
          const key = `${it.kind}-${it.sort_order}`;
          const plan = rects.get(key);
          const page = raster.find((p) => p.page_number === it.page_number);
          if (!plan || !page) {
            cropFails++;
            continue;
          }
          setPdfBusy(`从整页截取第 ${it.sort_order} 题图表…`);
          try {
            const crop = await cropImageBlob(page.blob, { ...plan, mode: "figure" });
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
          return {
            kind: it.kind,
            sort_order: it.sort_order,
            page_number: it.page_number,
            stem: it.stem,
            option_a: it.option_a,
            option_b: it.option_b,
            option_c: it.option_c,
            option_d: it.option_d,
            option_e: it.option_e,
            correct_answer: it.correct_answer || "",
            content: it.content,
            max_score: it.max_score,
            reviewed: true,
            needs_image: it.needs_image,
            image_url: crop,
            page_image_url: pageUrl,
          };
        });
        setItems(nextItems);
        const mcq = parsed.filter((it) => it.kind === "mcq").length;
        const frq = parsed.filter((it) => it.kind === "frq").length;
        if (cropFails > 0) {
          toast.message(`已切出 ${mcq} 道选择题、${frq} 道大题，截到 ${figures} 张图表。${cropFails} 道带图题没截到，请手工补。`);
        } else {
          toast.success(`已切出 ${mcq} 道选择题、${frq} 道大题，并从整页截出 ${figures} 张对应图表。AI 正在扫一眼切题质量。`);
        }
        setPdfBusy("保存切题结果…");
        await authFetch("/api/teacher/pdf", {
          method: "POST",
          body: JSON.stringify({
            action: "save-items",
            import_id: importId,
            items: nextItems,
          }),
        });
        await runPdfAi(importId, nextItems);
      } else {
        toast.success("未能自动切题，请手工加题后再提交");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF 处理失败");
    } finally {
      setPdfBusy("");
    }
  }

  async function openImport(id: string): Promise<{ pages: PdfPage[] } | null> {
    setActiveImport(id);
    const r = await authFetch(`/api/teacher/pdf?id=${id}`);
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "无法打开");
      return null;
    }
    setPages(j.pages ?? []);
    const loadedPages = (j.pages ?? []) as PdfPage[];
    const nextItems: PdfItem[] = (j.items ?? []).map((it: PdfItem & { stem?: string | null }) => {
        const page = loadedPages.find((p) => p.page_number === it.page_number);
        const blob = `${it.stem ?? ""} ${it.content ?? ""}`;
        const needs = it.needs_image ?? looksLikeProvidedFigure(blob);
        const stored = it.image_url && !isPageShot(it.image_url) ? it.image_url : null;
        const guessed = needs && page ? cropUrlFromPage(page.image_url, it.kind, it.sort_order) : null;
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
          content: it.content ?? "",
          image_url: stored || guessed,
          page_image_url: page?.image_url ?? null,
          needs_image: needs,
        };
      });
    const keyed = applyKnownApAnswerKey(nextItems, j.import?.filename ?? "");
    const applied = sortPdfItems(keyed.map((it) => {
      if (it.image_url || !it.needs_image) return it;
      const page = loadedPages.find((p) => p.page_number === it.page_number);
      return { ...it, image_url: page ? cropUrlFromPage(page.image_url, it.kind, it.sort_order) : null };
    }));
    const classId = String(j.import?.class_id ?? "");
    const published = j.import?.status === "published";
    const withFigures = applied.filter((it) => it.needs_image && (it.page_image_url || it.image_url) && !(it.image_url ?? "").startsWith("blob:") && !(it.image_url ?? "").startsWith("data:"));
    if (withFigures.length > 0) setPdfBusy("从整页重新截出图表（不含题干）…");
    const pageBlobs = new Map<number, Blob>();
    const tightened = await Promise.all(applied.map(async (it) => {
      if (!it.needs_image) return it;
      const page = loadedPages.find((p) => p.page_number === it.page_number);
      const hint = it.kind === "frq"
        ? "frq"
        : /graph provided|the graph|figure provided/i.test(`${it.stem} ${it.content}`)
          ? "graph"
          : /table provided|the table|payoff|RKB|JCM/i.test(`${it.stem} ${it.content}`)
            ? "table"
            : "any";
      try {
        let next: Blob | null = null;
        if (page?.image_url) {
          let pageBlob = pageBlobs.get(it.page_number);
          if (!pageBlob) {
            const pageRes = await fetch(page.image_url);
            if (pageRes.ok) {
              pageBlob = await pageRes.blob();
              pageBlobs.set(it.page_number, pageBlob);
            }
          }
          if (pageBlob) next = await cropFigureFromExamPage(pageBlob, hint);
        }
        if (!next && it.image_url && !it.image_url.startsWith("blob:") && !it.image_url.startsWith("data:")) {
          const res = await fetch(it.image_url);
          if (res.ok) next = await refineFigureBlob(await res.blob());
        }
        if (!next) return it;
        if (classId) {
          try {
            const uploaded = await putAssignmentPng(classId, id, `${it.kind}-${it.sort_order}.png`, next);
            return { ...it, image_url: `${uploaded.split("?")[0]}?v=${Date.now()}` };
          } catch {
            /* keep local preview */
          }
        }
        return { ...it, image_url: URL.createObjectURL(next) };
      } catch {
        return it;
      }
    }));
    setItems(tightened);
    setPdfFindings([]);
    setPdfAiRan(false);
    setPdfAiDone(published);
    setPdfTitle(j.import?.filename?.replace(/\.pdf$/i, "") ?? "");
    if (withFigures.length > 0) setPdfBusy("");
    if (tightened.length > 0 && !published) {
      void runPdfAi(id, tightened);
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
      const ready = applyKnownApAnswerKey(items, pdfTitle || "2022");
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
      toast.success(`已提交「${j.paper.title}」。班级可布置这场考试；是否进入题库由管理员在后台决定。`);
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

  if (authLoading || (!ready && user && !denied)) {
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
            <Link to="/auth" search={{ redirect: "/teacher" }}>去登录</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">返回首页</Link>
          </Button>
        </div>
      </main>
    );
  }
  if (denied) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold">需要教师权限</h1>
          <p className="text-sm text-muted-foreground">请让管理员把你的账号设为 teacher，或使用管理员账号进入。</p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">返回首页</Link>
          </Button>
        </div>
      </main>
    );
  }

  const copy = PAGE_COPY[page];
  const accountLabel = user.email?.split("@")[0] ?? "教师";
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const rosterQueryText = rosterQuery.trim().toLowerCase();
  const shownRoster = rosterQueryText
    ? roster.filter((r) => `${r.student_id} ${r.student_name}`.toLowerCase().includes(rosterQueryText))
    : roster;
  const scoreQueryText = scoreQuery.trim().toLowerCase();
  const shownGrades = scoreQueryText
    ? gradeRows.filter((r) => `${r.student_id} ${r.student_name}`.toLowerCase().includes(scoreQueryText))
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
  const paperLabel = source === "random"
    ? "固定随机卷（60 道选择题 + 3 道大题）"
    : selectedPaper
      ? paperPickerLabel(selectedPaper)
      : "未选择";

  function go(next: TeacherPage) {
    setPage(next);
    if (next === "exam" && examStep === "edit" && !title.trim()) {
      setStartsAt(toLocalInput(new Date()));
      setEndsAt(toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
    }
  }

  function reviewExam() {
    if (roster.length === 0) {
      toast.error("请先导入学生名册，再布置考试。");
      go("roster");
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
    setExamStep("review");
  }

  function submitProgress(id: string) {
    if (snapshot?.id !== id || snapshot.rows.length === 0) return "—";
    const done = snapshot.rows.filter((r) => r.status === "submitted").length;
    return `${done} / ${snapshot.rows.length}`;
  }

  return (
    <div className="flex min-h-screen flex-col">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex max-w-[50vw] items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm font-medium hover:bg-white/60">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
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
        <nav className="mx-auto mt-3 flex w-full max-w-6xl gap-1 overflow-auto" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
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
            <span className="hidden shrink-0 rounded-full border border-white/80 bg-white/55 px-3 py-2 text-xs text-muted-foreground sm:inline-flex">
              {todayLabel}
            </span>
          </div>

          {page === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="我的学生" value={roster.length} hint={roster.length ? `${roster.filter((r) => r.user_id).length} 人已入场绑定` : "尚未导入学生"} icon={Users} />
                <StatCard label="进行中的考试" value={liveCount} hint={assignments.length ? `共布置 ${assignments.length} 场` : "创建考试后会显示在这里"} icon={ClipboardList} />
                <StatCard label="平均正确率" value={overviewRate == null ? "—" : `${overviewRate}%`} hint={overviewRate == null ? "暂无成绩数据" : "最近一场已交卷的选择题"} icon={BarChart3} />
                <StatCard label="待处理" value={pendingCount} hint={snapshot ? "最近一场尚未交卷" : "暂无待处理事项"} icon={Clock} />
              </div>
              <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
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
                <Button onClick={() => void importRoster(false)}>导入学生</Button>
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shownRoster.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono">{r.student_id}</TableCell>
                            <TableCell className="font-medium">{r.student_name}</TableCell>
                            <TableCell>本班</TableCell>
                            <TableCell>
                              <Pill tone={r.user_id ? "ok" : "muted"}>{r.user_id ? "已绑定" : "未入场"}</Pill>
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
                        <dt className="text-muted-foreground">考试时间</dt>
                        <dd className="font-medium">{new Date(startsAt).toLocaleString()} 至 {new Date(endsAt).toLocaleString()}</dd>
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
                    <Field label="选择班级">
                      <Input readOnly value={roster.length ? `本班（${roster.length} 人）` : "请先导入学生名册"} />
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="开始时间">
                        <Input type="datetime-local" className="min-w-0 w-full text-sm" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                      </Field>
                      <Field label="截止时间">
                        <Input type="datetime-local" className="min-w-0 w-full text-sm" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                      </Field>
                    </div>
                    <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      学生使用学号和考试码进入。未交卷的学生可在截止前重新进入；已提交的答卷不能重复提交。
                    </p>
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
                    <EmptyState icon={ClipboardList} title="还没有考试" hint="填好名称和试卷后生成考试码，把 6 位码发给学生即可。" />
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
                  <p className="mt-1 text-xs text-muted-foreground">考试发布并收到学生答卷后，成绩会显示在这里。</p>
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
                    {gradeMeta && (
                      <Button className="sm:ml-auto" onClick={() => void togglePublish(!gradeMeta.results_published)}>
                        {gradeMeta.results_published ? "取消公布成绩" : "公布成绩与解析"}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard label="班级正确率" value={gradeRate == null ? "—" : `${gradeRate}%`} hint={gradeRate == null ? "暂无成绩数据" : "已交卷选择题"} />
                    <StatCard label="已提交" value={gradeId ? `${submittedCount} / ${gradeRows.length}` : "0 / 0"} hint={gradeId ? `${inProgressCount} 人作答中` : "请选择一场考试"} />
                    <StatCard label="最高正确率" value={bestScore < 0 ? "—" : `${Math.round(bestScore * 100)}%`} hint={bestScore < 0 ? "暂无成绩数据" : "单份已交答卷"} />
                    <StatCard label="已交大题" value={frqCount} hint={frqCount ? "可在下方查看原文" : "暂无大题作答"} />
                  </div>
                  <section className="glass overflow-hidden rounded-2xl">
                    <div className="px-5 py-4">
                      <h2 className="text-[15px] font-semibold">学生成绩</h2>
                      <p className="text-xs text-muted-foreground">{gradeMeta ? gradeMeta.title : "成绩会在学生提交答卷后显示"}</p>
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
                              <TableHead>学生</TableHead>
                              <TableHead>选择题</TableHead>
                              <TableHead>大题</TableHead>
                              <TableHead>提交状态</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {shownGrades.map((row) => (
                              <TableRow key={row.student_id}>
                                <TableCell>
                                  <div className="font-medium">{row.student_name}</div>
                                  <div className="font-mono text-[11px] text-muted-foreground">{row.student_id}</div>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {row.mcq_correct != null ? `${row.mcq_correct}/${row.mcq_total}` : "—"}
                                </TableCell>
                                <TableCell>
                                  {Object.keys(row.frq_answers ?? {}).length > 0 ? "已作答" : "—"}
                                </TableCell>
                                <TableCell>
                                  <Pill tone={row.status === "submitted" ? "ok" : row.status === "in_progress" ? "live" : "muted"}>
                                    {row.status === "submitted" ? "已提交" : row.status === "in_progress" ? "作答中" : "未交"}
                                  </Pill>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </section>
                  {gradeRows.some((r) => Object.keys(r.frq_answers ?? {}).length > 0) && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">大题原文</h3>
                      {gradeRows.filter((r) => r.status === "submitted" && Object.keys(r.frq_answers ?? {}).length > 0).map((r) => (
                        <div key={`frq-${r.student_id}`} className="glass space-y-2 rounded-2xl p-4 text-xs">
                          <div className="font-medium">{r.student_id} {r.student_name}</div>
                          {Object.entries(r.frq_answers ?? {}).map(([id, ans]) => (
                            <pre key={id} className="whitespace-pre-wrap rounded-xl bg-white/60 p-3">{ans.text || (ans.fileUrl ? ans.fileUrl : "（空）")}</pre>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
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
                      <p className="mt-3 text-xs text-amber-800">AI 标出 {pdfFindings.length} 道题需要看一眼，其余题目可以直接用。</p>
                    )}
                  </section>
                  <PdfQuestionList
                    items={items}
                    findings={pdfFindings}
                    aiRan={pdfAiRan}
                    onChange={(idx, patch) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)))}
                    onRemove={(idx) => setItems((xs) => xs.filter((_, i) => i !== idx))}
                  />
                </div>
              )}
            </div>
          )}
      </div>

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
    </div>
  );
}
