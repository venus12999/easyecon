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
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
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
    <div className="glass rounded-2xl px-6 py-12 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/70" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
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
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfBusy, setPdfBusy] = useState("");
  const [pdfFindings, setPdfFindings] = useState<PdfAiFinding[]>([]);
  const [pdfAiRan, setPdfAiRan] = useState(false);
  const [pdfAiDone, setPdfAiDone] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
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
      setTab("assign");
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
                          {paperPickerLabel(p)}
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
                上传 PDF 后会自动切题，并强制让 AI 先审一遍。你只需改被标出来的题，然后保存并提交到后台。是否进入模拟考试或练习库，由管理员决定。
              </p>
              <label className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-4 py-8 text-center transition hover:bg-primary/10",
                pdfBusy && "pointer-events-none opacity-70",
              )}>
                <FileUp className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium">{pdfBusy || "点击选择 PDF"}</span>
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
            </CardContent>
          </Card>
          {imports.length === 0 && !activeImport ? (
            <EmptyState icon={FileUp} title="还没有 PDF 导入" hint="现有卷库不够用时再上传。日常考试可直接用「布置考试」里的卷库。" />
          ) : (
            <div className="space-y-2">
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
                      className="ml-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
              <Card className="glass rounded-2xl border-white/60 shadow-none">
                <CardContent className="space-y-3 p-5">
                  <Field label="试卷标题">
                    <Input placeholder="例如：2022 AP Micro" value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "mcq")])}>加选择题</Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "frq")])}>加大题</Button>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={aiBusy || !items.length} onClick={() => void runPdfAi(activeImport, items)}>
                      {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {aiBusy ? "AI 审核中…" : "再跑一遍 AI 审核"}
                    </Button>
                    <Button
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={!!pdfBusy || aiBusy || !items.length || !pdfAiDone || alreadyPublished}
                      onClick={() => void saveAndPublish()}
                    >
                      {pdfBusy === "保存并提交到后台…" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {pdfBusy === "保存并提交到后台…" ? "提交中…" : alreadyPublished ? "已提交到后台" : "保存并提交到后台"}
                    </Button>
                  </div>
                  {alreadyPublished && (
                    <p className="text-xs text-muted-foreground">这份卷已经提交。改题请重新上传 PDF，不要在这里再点提交，以免卷库里出现重复的学校卷。</p>
                  )}
                  {aiBusy && (
                    <p className="text-xs text-muted-foreground">AI 正在审核切题，审完后即可提交。</p>
                  )}
                  {!pdfAiDone && items.length > 0 && !aiBusy && !alreadyPublished && (
                    <p className="text-xs text-muted-foreground">请等 AI 审完，或点「再跑一遍 AI 审核」后再提交。</p>
                  )}
                  {pdfFindings.length > 0 && (
                    <p className="text-xs text-amber-800">AI 标出 {pdfFindings.length} 道题需要看一眼，其余题目可以直接用。</p>
                  )}
                </CardContent>
              </Card>
              <PdfQuestionList
                items={items}
                findings={pdfFindings}
                aiRan={pdfAiRan}
                onChange={(idx, patch) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, ...patch } : x))}
                onRemove={(idx) => setItems((xs) => xs.filter((_, i) => i !== idx))}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
