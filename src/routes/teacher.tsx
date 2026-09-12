import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  BarChart3,
  Check,
  ClipboardList,
  Copy,
  FileUp,
  Loader2,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { examSlugFromFilename, parseApExamPages } from "@/lib/ap-exam-parse";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/teacher")({
  head: () => ({ meta: [{ title: "教师端 · 学校考试" }, { name: "robots", content: "noindex" }] }),
  component: TeacherHome,
});

type RosterRow = { id: string; student_id: string; student_name: string; user_id: string | null };
type Paper = { id: string; slug: string; title: string; year: number | null };
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
type PdfItem = {
  id?: string;
  kind: "mcq" | "frq";
  sort_order: number;
  page_number: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  content: string;
  max_score: number;
  reviewed: boolean;
};

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
    <div className="glass rounded-2xl px-6 py-12 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/70" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
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
    correct_answer: "A",
    content: "",
    max_score: 9,
    reviewed: false,
  };
}

function TeacherHome() {
  const { user, loading: authLoading } = useAuth();
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
  const [pdfBusy, setPdfBusy] = useState("");
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfToMock, setPdfToMock] = useState(false);
  const [tab, setTab] = useState("roster");
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
      setTitle("");
      await loadAssignments();
      setGradeId(j.assignment.id);
      setTab("assign");
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
    setTab("grades");
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

  async function onPdfFile(file: File) {
    setPdfBusy("正在把每一页渲染成图片…");
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
      for (const page of raster) {
        setPdfBusy(`上传第 ${page.page_number} 页…`);
        const fd = new FormData();
        fd.append("file", new File([page.blob], `page-${page.page_number}.png`, { type: "image/png" }));
        fd.append("import_id", importId);
        fd.append("page_number", String(page.page_number));
        fd.append("extracted_text", page.extracted_text);
        const up = await authFetch("/api/teacher/pdf", { method: "POST", body: fd });
        if (!up.ok) {
          const uj = await up.json().catch(() => ({}));
          throw new Error(uj.error ?? `第 ${page.page_number} 页上传失败`);
        }
      }
      await openImport(importId);
      await loadPdfs();
      const parsed = parseApExamPages(
        raster.map((page) => ({ page_number: page.page_number, extracted_text: page.extracted_text })),
      );
      if (parsed.length > 0) {
        setItems(
          parsed.map((it) => ({
            kind: it.kind,
            sort_order: it.sort_order,
            page_number: it.page_number,
            stem: it.stem,
            option_a: it.option_a,
            option_b: it.option_b,
            option_c: it.option_c,
            option_d: it.option_d,
            option_e: it.option_e,
            correct_answer: it.correct_answer || "A",
            content: it.content,
            max_score: it.max_score,
            reviewed: false,
          })),
        );
        const mcq = parsed.filter((it) => it.kind === "mcq").length;
        const frq = parsed.filter((it) => it.kind === "frq").length;
        toast.success(`硬编程已切出 ${mcq} 道选择题、${frq} 道大题。图表题会挂上整页图，请核对答案后再发布`);
        setPdfBusy("保存切题结果…");
        await authFetch("/api/teacher/pdf", {
          method: "POST",
          body: JSON.stringify({
            action: "save-items",
            import_id: importId,
            items: parsed.map((it) => ({
              kind: it.kind,
              sort_order: it.sort_order,
              page_number: it.page_number,
              stem: it.stem,
              option_a: it.option_a,
              option_b: it.option_b,
              option_c: it.option_c,
              option_d: it.option_d,
              option_e: it.option_e,
              correct_answer: it.correct_answer || null,
              content: it.content,
              max_score: it.max_score,
              reviewed: false,
            })),
          }),
        });
      } else {
        toast.success("页图已生成，未能自动切题，请按页手工切题后再发布");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF 处理失败");
    } finally {
      setPdfBusy("");
    }
  }

  async function openImport(id: string) {
    setActiveImport(id);
    const r = await authFetch(`/api/teacher/pdf?id=${id}`);
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "无法打开");
      return;
    }
    setPages(j.pages ?? []);
    setItems(
      (j.items ?? []).map((it: PdfItem & { stem?: string | null }) => ({
        ...emptyItem(it.page_number, it.sort_order, it.kind),
        ...it,
        stem: it.stem ?? "",
        option_a: it.option_a ?? "",
        option_b: it.option_b ?? "",
        option_c: it.option_c ?? "",
        option_d: it.option_d ?? "",
        option_e: it.option_e ?? "",
        correct_answer: it.correct_answer ?? "A",
        content: it.content ?? "",
      })),
    );
    setPdfTitle(j.import?.filename?.replace(/\.pdf$/i, "") ?? "");
  }

  async function saveItems() {
    if (!activeImport) return;
    const r = await authFetch("/api/teacher/pdf", {
      method: "POST",
      body: JSON.stringify({ action: "save-items", import_id: activeImport, items }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "保存失败");
      return;
    }
    toast.success("已保存切题");
    await loadPdfs();
  }

  async function publishPdf() {
    if (!activeImport) return;
    if (items.some((it) => !it.reviewed)) {
      toast.error("请先勾选「已校对」再发布");
      return;
    }
    const r = await authFetch("/api/teacher/pdf", {
      method: "POST",
      body: JSON.stringify({
        action: "publish",
        import_id: activeImport,
        title: pdfTitle,
        promote_requested: pdfToMock,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "提交失败");
      return;
    }
    toast.success(pdfToMock
      ? `已提交「${j.paper.title}」。班级可布置这场考试；是否进入模拟考试真题库，由管理员在后台审核。`
      : `已发布「${j.paper.title}」，可去「布置考试」选题。日常选择题/大题库不会出现这些题。`);
    await Promise.all([loadPdfs(), loadAssignments()]);
    setPaperId(j.paper.id);
    setSource("existing");
    setTab("assign");
  }

  const libraryPapers = useMemo(
    () => papers.filter((p) => !p.slug.startsWith("frq-")),
    [papers],
  );
  const selectedPaper = libraryPapers.find((p) => p.id === paperId);

  useEffect(() => {
    if (paperId) return;
    const first = libraryPapers[0];
    if (first) setPaperId(first.id);
  }, [libraryPapers, paperId]);

  if (authLoading) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </main>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <div className="glass mx-auto max-w-sm rounded-2xl p-8 space-y-3">
          <h1 className="text-xl font-bold">请先登录</h1>
          <p className="text-sm text-muted-foreground">教师工作台需要登录后才能布置考试。</p>
          <Button asChild className="w-full">
            <Link to="/auth" search={{ redirect: "/teacher" }}>去登录</Link>
          </Button>
        </div>
      </main>
    );
  }
  if (denied) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="glass mx-auto max-w-sm rounded-2xl p-8 space-y-3">
          <h1 className="text-xl font-bold">需要教师权限</h1>
          <p className="text-sm text-muted-foreground">请让管理员把你的账号设为 teacher，或使用管理员账号进入。</p>
        </div>
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </main>
    );
  }

  const submittedCount = gradeRows.filter((r) => r.status === "submitted").length;
  const inProgressCount = gradeRows.filter((r) => r.status === "in_progress").length;

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-8 sm:pb-16 space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium tracking-wide text-primary">学校计分考</p>
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl">教师工作台</h1>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            导入花名册后生成考试码。学生凭学号、姓名和考试码入场，未交卷可再次进入。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="glass rounded-2xl px-3 py-2 sm:min-w-[92px] sm:px-4 sm:py-2.5">
            <div className="text-base font-semibold tabular-nums sm:text-lg">{roster.length}</div>
            <div className="text-[11px] text-muted-foreground">花名册</div>
          </div>
          <div className="glass rounded-2xl px-3 py-2 sm:min-w-[92px] sm:px-4 sm:py-2.5">
            <div className="text-base font-semibold tabular-nums sm:text-lg">{assignments.length}</div>
            <div className="text-[11px] text-muted-foreground">已布置</div>
          </div>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          if (v === "assign" && !title.trim()) {
            setStartsAt(toLocalInput(new Date()));
            setEndsAt(toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
          }
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-4 rounded-2xl p-1">
          <TabsTrigger value="roster" className="w-full flex-col gap-0.5 rounded-xl px-1 py-2 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
            <Users className="h-3.5 w-3.5" />
            花名册
          </TabsTrigger>
          <TabsTrigger value="assign" className="w-full flex-col gap-0.5 rounded-xl px-1 py-2 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="sm:hidden">布置</span>
            <span className="hidden sm:inline">布置考试</span>
          </TabsTrigger>
          <TabsTrigger value="grades" className="w-full flex-col gap-0.5 rounded-xl px-1 py-2 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
            <BarChart3 className="h-3.5 w-3.5" />
            成绩册
          </TabsTrigger>
          <TabsTrigger value="pdf" className="w-full flex-col gap-0.5 rounded-xl px-1 py-2 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
            <FileUp className="h-3.5 w-3.5" />
            <span className="sm:hidden">PDF</span>
            <span className="hidden sm:inline">PDF 出题</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4 space-y-4">
          <Card className="glass rounded-2xl border-white/60 shadow-none">
            <CardContent className="space-y-3 p-5">
              <Field label="粘贴花名册" hint="两列：学号,姓名。可从 Excel 另存为 CSV 后整表粘贴。追加不会清掉已有学生。覆盖会整表替换；有未结束的考试时不能覆盖。">
                <Textarea
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="min-h-[8rem] font-mono text-sm sm:min-h-[10rem]"
                  aria-label="花名册 CSV"
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto" onClick={() => void importRoster(false)}>追加导入</Button>
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => void importRoster(true)}>覆盖导入</Button>
              </div>
            </CardContent>
          </Card>
          {roster.length === 0 ? (
            <EmptyState icon={Users} title="还没有学生" hint="粘贴学号和姓名后点「追加导入」，学生才能用考试码入场。" />
          ) : (
            <Card className="glass overflow-hidden rounded-2xl border-white/60 shadow-none">
              <CardContent className="p-0">
                <div className="flex items-center justify-between px-5 py-3">
                  <p className="text-sm font-medium">当前 {roster.length} 人</p>
                  <p className="text-xs text-muted-foreground">
                    {roster.filter((r) => r.user_id).length} 人已入场绑定
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="whitespace-nowrap">学号</TableHead>
                        <TableHead className="whitespace-nowrap">姓名</TableHead>
                        <TableHead className="whitespace-nowrap">账号</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roster.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap font-mono">{r.student_id}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.student_name}</TableCell>
                          <TableCell>
                            <Pill tone={r.user_id ? "ok" : "muted"}>{r.user_id ? "已绑定" : "未入场"}</Pill>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="assign" className="mt-4 space-y-4">
          <Card className="glass rounded-2xl border-white/60 shadow-none">
            <CardContent className="space-y-4 p-5">
              <Field label="考试名称">
                <Input placeholder="例如：期中考试" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="试卷来源">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={source === "existing" ? "default" : "outline"} onClick={() => setSource("existing")}>
                    现有卷库
                  </Button>
                  <Button type="button" variant={source === "random" ? "default" : "outline"} onClick={() => setSource("random")}>
                    生成固定随机卷
                  </Button>
                </div>
              </Field>
              {source === "existing" && (
                <Field label="选择试卷">
                  <Select value={paperId} onValueChange={setPaperId}>
                    <SelectTrigger><SelectValue placeholder="选择试卷" /></SelectTrigger>
                    <SelectContent>
                      {libraryPapers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}{p.slug.startsWith("school-") ? " · 学校卷" : p.year ? ` · ${p.year}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {source === "existing" && selectedPaper && !selectedPaper.slug.startsWith("school-") && (
                <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  这是公开卷库。未走考试入场的学生仍可能在「模考」里练习同一份卷。课上请只用考试码入场；随机卷或 PDF 导入卷不会出现在公开模考列表。
                </p>
              )}
              {source === "random" && (
                <p className="rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  开考前抽好 60 题选择题 + 3 道大题，全班同一套，保证评分公平。题量较大，课上计时请预留充足时间。
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="开考时间">
                  <Input type="datetime-local" className="min-w-0 w-full text-sm" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
                <Field label="截止时间">
                  <Input type="datetime-local" className="min-w-0 w-full text-sm" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </Field>
              </div>
              <Button className="w-full sm:w-auto" onClick={() => void createAssignment()} disabled={creating || !title.trim() || (source === "existing" && !paperId)}>
                {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                生成考试码
              </Button>
            </CardContent>
          </Card>
          {assignments.length === 0 ? (
            <EmptyState icon={ClipboardList} title="还没有考试" hint="填好名称和试卷后点「生成考试码」，把 6 位码发给学生即可。" />
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => {
                const win = examWindow(a.starts_at, a.ends_at);
                return (
                  <Card key={a.id} className="glass rounded-2xl border-white/60 shadow-none">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{a.title}</h2>
                          <Pill tone={win.tone}>{win.label}</Pill>
                          <Pill tone={a.results_published ? "ok" : "muted"}>
                            {a.results_published ? "已公布解析" : "未公布解析"}
                          </Pill>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {a.paper?.title ?? "试卷"}
                          <span className="hidden sm:inline"> · {new Date(a.starts_at).toLocaleString()} – {new Date(a.ends_at).toLocaleString()}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground sm:hidden">
                          {new Date(a.starts_at).toLocaleString()} – {new Date(a.ends_at).toLocaleString()}
                        </p>
                        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                          <span className="font-mono text-lg tracking-[0.12em] sm:text-xl sm:tracking-[0.16em]">{a.exam_code}</span>
                          <Button size="sm" variant="outline" className="h-8 w-full gap-1 sm:w-auto" onClick={() => void copyCode(a.exam_code)}>
                            {copied === a.exam_code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied === a.exam_code ? "已复制" : "复制考试码"}
                          </Button>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void loadGradebook(a.id)}>
                        查看成绩册
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="grades" className="mt-4 space-y-4">
          {assignments.length === 0 ? (
            <EmptyState icon={BarChart3} title="还没有可查看的考试" hint="先到「布置考试」生成考试码，学生交卷后这里会出现成绩。" />
          ) : (
            <>
              <Card className="glass rounded-2xl border-white/60 shadow-none">
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Field label="选择考试">
                      <Select value={gradeId} onValueChange={(id) => void loadGradebook(id)}>
                        <SelectTrigger><SelectValue placeholder="选择一场考试" /></SelectTrigger>
                        <SelectContent>
                          {assignments.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  {gradeMeta && (
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      <Button size="sm" className="w-full sm:w-auto" onClick={() => void togglePublish(!gradeMeta.results_published)}>
                        {gradeMeta.results_published ? "取消公布成绩" : "公布成绩与解析"}
                      </Button>
                      <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={exportCsv}>导出 CSV</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              {gradeMeta && (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Pill tone="ok">{submittedCount} 已交</Pill>
                  <Pill tone="live">{inProgressCount} 作答中</Pill>
                  <Pill tone="muted">{Math.max(0, gradeRows.length - submittedCount - inProgressCount)} 未交</Pill>
                </div>
              )}
              {!gradeId ? (
                <EmptyState icon={BarChart3} title="请选择一场考试" hint="从上方下拉框挑一场，或从「布置考试」点「查看成绩册」。" />
              ) : gradeRows.length === 0 ? (
                <EmptyState icon={Users} title="这份成绩册还是空的" hint="确认花名册已导入。学生入场后会出现「作答中」，交卷后显示选择题对错。" />
              ) : (
                <Card className="glass overflow-hidden rounded-2xl border-white/60 shadow-none">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="whitespace-nowrap">学号</TableHead>
                            <TableHead className="whitespace-nowrap">姓名</TableHead>
                            <TableHead className="whitespace-nowrap">状态</TableHead>
                            <TableHead className="whitespace-nowrap">选择题</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gradeRows.map((row) => (
                            <TableRow key={row.student_id}>
                              <TableCell className="whitespace-nowrap font-mono">{row.student_id}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.student_name}</TableCell>
                              <TableCell>
                                <Pill tone={row.status === "submitted" ? "ok" : row.status === "in_progress" ? "live" : "muted"}>
                                  {row.status === "submitted" ? "已交" : row.status === "in_progress" ? "作答中" : "未交"}
                                </Pill>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {row.mcq_correct != null ? `${row.mcq_correct}/${row.mcq_total}` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
              {gradeRows.some((r) => Object.keys(r.frq_answers ?? {}).length > 0) && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">大题原文（学生端不展示得分）</h3>
                  {gradeRows.filter((r) => r.status === "submitted").map((r) => (
                    <Card key={`frq-${r.student_id}`} className="glass rounded-2xl border-white/60 shadow-none">
                      <CardContent className="space-y-2 p-4 text-xs">
                        <div className="font-medium">{r.student_id} {r.student_name}</div>
                        {Object.entries(r.frq_answers ?? {}).map(([id, ans]) => (
                          <pre key={id} className="whitespace-pre-wrap rounded-xl bg-muted/70 p-3">{ans.text || (ans.fileUrl ? ans.fileUrl : "（空）")}</pre>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="pdf" className="mt-4 space-y-4">
          <Card className="glass rounded-2xl border-white/60 shadow-none">
            <CardContent className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">
                上传 PDF 后会把每一页渲染成图，并按题号切开选择题/大题（图表题挂整页图，不靠 AI）。校对后提交到管理员后台：默认只给你布置学校考试用，学生在模拟考试、选择题、大题练习里都看不到。若要进入真题库，勾选申请，由管理员决定是否上架。
              </p>
              <label className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-4 py-8 text-center transition hover:bg-primary/10",
                pdfBusy && "pointer-events-none opacity-70",
              )}>
                <FileUp className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium">{pdfBusy || "点击选择 PDF"}</span>
                <span className="text-xs text-muted-foreground">建议先用少量页试跑，校对完成后再提交</span>
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
            </CardContent>
          </Card>
          {imports.length === 0 && !activeImport ? (
            <EmptyState icon={FileUp} title="还没有 PDF 导入" hint="现有卷库不够用时再上传。日常考试可直接用「布置考试」里的卷库。" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {imports.map((imp) => (
                <Button key={imp.id} size="sm" variant={activeImport === imp.id ? "default" : "outline"} onClick={() => void openImport(imp.id)}>
                  {imp.filename} · {imp.status}
                </Button>
              ))}
            </div>
          )}
          {activeImport && (
            <div className="space-y-4">
              <Card className="glass rounded-2xl border-white/60 shadow-none">
                <CardContent className="space-y-3 p-5">
                  <Field label="发布后的试卷标题">
                    <Input placeholder="例如：校本练习 1" value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} />
                  </Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={pdfToMock} onChange={(e) => setPdfToMock(e.target.checked)} />
                    <span>
                      申请列入模拟考试真题库（提交后由管理员在后台决定，不会自动进入选择题/大题练习库）。
                      {pdfToMock && pdfTitle ? ` 建议卷号 ${examSlugFromFilename(pdfTitle)}` : ""}
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "mcq")])}>加选择题</Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "frq")])}>加大题</Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setItems((xs) => xs.map((x) => ({ ...x, reviewed: true })))}>全部标为已校对</Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void saveItems()}>保存切题</Button>
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => void publishPdf()}>校对完成，提交到后台</Button>
                  </div>
                </CardContent>
              </Card>
              {pages.map((p) => (
                <Card key={p.id} className="glass rounded-2xl border-white/60 shadow-none">
                  <CardContent className="space-y-2 p-4">
                    <div className="text-sm font-medium">第 {p.page_number} 页</div>
                    <img src={p.image_url} alt={`page ${p.page_number}`} className="w-full rounded-xl border" />
                    {p.extracted_text && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">{p.extracted_text.slice(0, 400)}</p>}
                  </CardContent>
                </Card>
              ))}
              {items.map((it, idx) => (
                <Card key={idx} className="glass rounded-2xl border-white/60 shadow-none">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={it.kind} onValueChange={(v) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, kind: v as "mcq" | "frq" } : x))}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mcq">选择题</SelectItem>
                          <SelectItem value="frq">大题</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="w-24"
                        type="number"
                        aria-label="页码"
                        value={it.page_number}
                        onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, page_number: Number(e.target.value) } : x))}
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={it.reviewed}
                          onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, reviewed: e.target.checked } : x))}
                        />
                        已校对
                      </label>
                      <Button size="sm" variant="ghost" onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}>删除</Button>
                    </div>
                    <Input placeholder="题干（可短，页图会挂到本题）" value={it.stem} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, stem: e.target.value } : x))} />
                    {it.kind === "mcq" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((k, n) => (
                          <Input key={k} placeholder={`选项 ${"ABCDE"[n]}`} value={it[k]} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, [k]: e.target.value } : x))} />
                        ))}
                        <Input placeholder="正确答案 A-E" value={it.correct_answer} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, correct_answer: e.target.value.toUpperCase() } : x))} />
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Textarea placeholder="大题文字（可与页图互补）" value={it.content} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, content: e.target.value } : x))} />
                        <Input type="number" placeholder="满分" value={it.max_score} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, max_score: Number(e.target.value) } : x))} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
