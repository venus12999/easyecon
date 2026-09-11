import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";

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
      toast.success(`考试码 ${j.assignment.exam_code}`);
      setTitle("");
      await loadAssignments();
      setGradeId(j.assignment.id);
    } finally {
      setCreating(false);
    }
  }

  async function loadGradebook(id: string) {
    setGradeId(id);
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
      toast.success("页图已生成，请按页切题并校对后再发布");
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
      body: JSON.stringify({ action: "publish", import_id: activeImport, title: pdfTitle }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error ?? "发布失败");
      return;
    }
    toast.success(`已发布试卷 ${j.paper.title}，可去「布置考试」选题`);
    await Promise.all([loadPdfs(), loadAssignments()]);
    setPaperId(j.paper.id);
    setSource("existing");
  }

  const libraryPapers = useMemo(
    () => papers.filter((p) => !p.slug.startsWith("frq-")),
    [papers],
  );

  if (authLoading) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </main>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-3">
        <h1 className="text-xl font-bold">请先登录</h1>
        <Button asChild>
          <Link to="/auth" search={{ redirect: "/teacher" }}>去登录</Link>
        </Button>
      </main>
    );
  }
  if (denied) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-3">
        <h1 className="text-xl font-bold">需要教师权限</h1>
        <p className="text-sm text-muted-foreground">请让管理员把你的账号设为 teacher，或使用管理员账号进入。</p>
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

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">教师端</h1>
        <p className="text-sm text-muted-foreground">布置计分考：花名册、考试码、成绩册。PDF 必须整页出图并人工校对后才能发布。</p>
      </div>
      <Tabs defaultValue="roster">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="roster">花名册</TabsTrigger>
          <TabsTrigger value="assign">布置考试</TabsTrigger>
          <TabsTrigger value="grades">成绩册</TabsTrigger>
          <TabsTrigger value="pdf">PDF 出题</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">CSV 两列：学号,姓名。可从 Excel 另存为 CSV 后粘贴。</p>
              <Textarea rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => void importRoster(false)}>追加导入</Button>
                <Button variant="outline" onClick={() => void importRoster(true)}>覆盖导入</Button>
              </div>
            </CardContent>
          </Card>
          <p className="text-sm">当前 {roster.length} 人</p>
          <div className="overflow-x-auto text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">学号</th>
                  <th>姓名</th>
                  <th>账号</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1 font-mono">{r.student_id}</td>
                    <td>{r.student_name}</td>
                    <td>{r.user_id ? "已绑定" : "未入场"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="assign" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <Input placeholder="考试名称，如 期中考试" value={title} onChange={(e) => setTitle(e.target.value)} />
              <div className="flex gap-2">
                <Button type="button" variant={source === "existing" ? "default" : "outline"} onClick={() => setSource("existing")}>现有卷库</Button>
                <Button type="button" variant={source === "random" ? "default" : "outline"} onClick={() => setSource("random")}>生成固定随机卷</Button>
              </div>
              {source === "existing" && (
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
              )}
              {source === "random" && (
                <p className="text-xs text-muted-foreground">开考前抽好 60 题 + 3 道 FRQ，全班同一套，保证评分公平。</p>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-muted-foreground space-y-1">
                  开考
                  <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </label>
                <label className="text-xs text-muted-foreground space-y-1">
                  截止
                  <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </label>
              </div>
              <Button onClick={() => void createAssignment()} disabled={creating || !title.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                生成考试码
              </Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {assignments.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.paper?.title} · {new Date(a.starts_at).toLocaleString()} – {new Date(a.ends_at).toLocaleString()}</div>
                    <div className="mt-1 font-mono text-lg tracking-[0.25em]">{a.exam_code}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadGradebook(a.id)}>成绩册</Button>
                    <span className="text-xs text-muted-foreground self-center">{a.results_published ? "已公布" : "未公布解析"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="grades" className="space-y-4">
          <Select value={gradeId} onValueChange={(id) => void loadGradebook(id)}>
            <SelectTrigger><SelectValue placeholder="选择一场考试" /></SelectTrigger>
            <SelectContent>
              {assignments.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {gradeMeta && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void togglePublish(!gradeMeta.results_published)}>
                {gradeMeta.results_published ? "取消公布成绩" : "公布成绩与解析"}
              </Button>
              <Button size="sm" variant="outline" onClick={exportCsv}>导出 CSV</Button>
            </div>
          )}
          <div className="overflow-x-auto text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">学号</th>
                  <th>姓名</th>
                  <th>状态</th>
                  <th>MCQ</th>
                </tr>
              </thead>
              <tbody>
                {gradeRows.map((row) => (
                  <tr key={row.student_id} className="border-t align-top">
                    <td className="py-1 font-mono">{row.student_id}</td>
                    <td>{row.student_name}</td>
                    <td>{row.status === "submitted" ? "已交" : row.status === "in_progress" ? "作答中" : "未交"}</td>
                    <td>{row.mcq_correct != null ? `${row.mcq_correct}/${row.mcq_total}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gradeRows.some((r) => Object.keys(r.frq_answers ?? {}).length > 0) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">FRQ 原文（学生端不展示得分）</h3>
              {gradeRows.filter((r) => r.status === "submitted").map((r) => (
                <Card key={`frq-${r.student_id}`}>
                  <CardContent className="p-3 text-xs space-y-2">
                    <div className="font-medium">{r.student_id} {r.student_name}</div>
                    {Object.entries(r.frq_answers ?? {}).map(([id, ans]) => (
                      <pre key={id} className="whitespace-pre-wrap bg-muted rounded p-2">{ans.text || (ans.fileUrl ? ans.fileUrl : "（空）")}</pre>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="pdf" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">上传 PDF 后系统把每一页栅格化成图。请按页切题、校对选项和答案，全部勾选「已校对」才能发布。未发布的卷不能开考。</p>
              <Input
                type="file"
                accept="application/pdf"
                disabled={!!pdfBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPdfFile(f);
                  e.target.value = "";
                }}
              />
              {pdfBusy && <p className="text-sm text-primary">{pdfBusy}</p>}
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            {imports.map((imp) => (
              <Button key={imp.id} size="sm" variant={activeImport === imp.id ? "default" : "outline"} onClick={() => void openImport(imp.id)}>
                {imp.filename} · {imp.status}
              </Button>
            ))}
          </div>
          {activeImport && (
            <div className="space-y-4">
              <Input placeholder="发布后的试卷标题" value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "mcq")])}>加选择题</Button>
                <Button size="sm" variant="outline" onClick={() => setItems((xs) => [...xs, emptyItem(pages[0]?.page_number ?? 1, xs.length + 1, "frq")])}>加大题</Button>
                <Button size="sm" variant="outline" onClick={() => void saveItems()}>保存切题</Button>
                <Button size="sm" onClick={() => void publishPdf()}>校对完成，发布试卷</Button>
              </div>
              {pages.map((p) => (
                <Card key={p.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="text-sm font-medium">第 {p.page_number} 页</div>
                    <img src={p.image_url} alt={`page ${p.page_number}`} className="w-full rounded border" />
                    {p.extracted_text && <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{p.extracted_text.slice(0, 400)}</p>}
                  </CardContent>
                </Card>
              ))}
              {items.map((it, idx) => (
                <Card key={idx}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex flex-wrap gap-2 items-center">
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
                        value={it.page_number}
                        onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, page_number: Number(e.target.value) } : x))}
                      />
                      <label className="text-xs flex items-center gap-1">
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
                      <div className="grid sm:grid-cols-2 gap-2">
                        {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((k, n) => (
                          <Input key={k} placeholder={`选项 ${"ABCDE"[n]}`} value={it[k]} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, [k]: e.target.value } : x))} />
                        ))}
                        <Input placeholder="正确答案 A-E" value={it.correct_answer} onChange={(e) => setItems((xs) => xs.map((x, i) => i === idx ? { ...x, correct_answer: e.target.value.toUpperCase() } : x))} />
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-2">
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
