import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload, Image as ImageIcon, Sparkles } from "lucide-react";

// 判断题干是否提示包含图表（导入时在题干里以「[此题含图…]」「见原 PDF」「见图」等方式标注）
function hasImageMarker(stem: string): boolean {
  if (!stem) return false;
  return /\[\s*(此题|本题)?\s*含图|\[图|见原\s*PDF|见图|见下图|见上图|图\s*\d+|graph|figure|the\s+(above|following)\s+(graph|figure|diagram|table)/i.test(
    stem,
  );
}

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "题库管理" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

type Kp = { id: string; slug: string; name_en: string; name_zh: string; unit: number };
type Q = {
  id: string;
  knowledge_point_id: string;
  type: "basic" | "application" | "pitfall";
  difficulty: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  explanation: string;
  pitfall_note: string | null;
  term_tags: string[] | null;
  status: "draft" | "published";
  image_url: string | null;
};

function Admin() {
  const [token, setToken] = useState<string | null>(null);
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem("admin_token");
    if (t) setToken(t);
  }, []);

  async function login() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!res.ok) {
        toast.error("密码错误");
        return;
      }
      const j = await res.json();
      sessionStorage.setItem("admin_token", j.token);
      setToken(j.token);
      toast.success("登录成功");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-sm px-4 py-16">
          <h1 className="text-xl font-bold mb-4">管理员登录</h1>
          <Card>
            <CardContent className="p-6 space-y-3">
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="管理员密码"
                onKeyDown={(e) => e.key === "Enter" && login()}
              />
              <Button onClick={login} disabled={loading || !pwd} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "进入"}
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return <AdminPanel token={token} onLogout={() => { sessionStorage.removeItem("admin_token"); setToken(null); }} />;
}

function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [kps, setKps] = useState<Kp[]>([]);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [filterKp, setFilterKp] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterImage, setFilterImage] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Q | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/questions", { headers: { "x-admin-token": token } });
    if (res.status === 401) {
      toast.error("会话过期，请重新登录");
      onLogout();
      return;
    }
    const j = await res.json();
    setKps(j.knowledge_points);
    setQuestions(j.questions);
  }, [token, onLogout]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = questions.filter((q) => {
    if (filterKp !== "all" && q.knowledge_point_id !== filterKp) return false;
    if (filterType !== "all" && q.type !== filterType) return false;
    if (filterImage === "image" && !hasImageMarker(q.stem)) return false;
    if (filterImage === "noimage" && hasImageMarker(q.stem)) return false;
    if (search && !q.stem.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const imageCount = questions.filter((q) => hasImageMarker(q.stem)).length;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">题库管理</h1>
          <Button variant="outline" size="sm" onClick={onLogout}>退出</Button>
        </div>

        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">题目列表</TabsTrigger>
            <TabsTrigger value="import">批量导入</TabsTrigger>
            <TabsTrigger value="audit">AI 审核</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <Select value={filterKp} onValueChange={setFilterKp}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部知识点</SelectItem>
                  {kps.map((k) => <SelectItem key={k.id} value={k.id}>{k.name_zh}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部题型</SelectItem>
                  <SelectItem value="basic">基础</SelectItem>
                  <SelectItem value="application">应用</SelectItem>
                  <SelectItem value="pitfall">易错</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterImage} onValueChange={setFilterImage}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部图文</SelectItem>
                  <SelectItem value="image">仅带图题 ({imageCount})</SelectItem>
                  <SelectItem value="noimage">仅纯文字题</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="搜索题干…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
              <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> 新建</Button>
              <span className="ml-auto text-sm text-muted-foreground">共 {filtered.length} 题</span>
            </div>

            <div className="space-y-2">
              {filtered.map((q) => (
                <Card key={q.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-secondary">{q.type}</span>
                        <span className="text-xs text-muted-foreground">{kps.find((k) => k.id === q.knowledge_point_id)?.name_zh}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${q.status === "published" ? "bg-success/15 text-success" : "bg-warning/15 text-warning-foreground"}`}>
                          {q.status === "published" ? "已发布" : "草稿"}
                        </span>
                        {hasImageMarker(q.stem) && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary inline-flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> {q.image_url ? "已上传图" : "带图待补"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm line-clamp-2">{q.stem}</p>
                      {q.image_url && (
                        <img
                          src={q.image_url}
                          alt="题目配图"
                          className="mt-2 max-h-24 rounded border border-border object-contain"
                        />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <ImageUploadButton
                        questionId={q.id}
                        token={token}
                        hasImage={!!q.image_url}
                        onChanged={reload}
                      />
                      <Button size="sm" variant="outline" onClick={() => setEditing(q)}>编辑</Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (!confirm("确认删除？")) return;
                        const r = await fetch("/api/admin/questions", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json", "x-admin-token": token },
                          body: JSON.stringify({ id: q.id }),
                        });
                        if (r.ok) { toast.success("已删除"); reload(); }
                        else toast.error("删除失败");
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <ImportPanel token={token} kps={kps} onDone={reload} />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <AuditPanel token={token} kps={kps} questions={questions} onApplied={reload} />
          </TabsContent>
        </Tabs>

        {(editing || creating) && (
          <EditDialog
            kps={kps}
            initial={editing}
            token={token}
            onClose={() => { setEditing(null); setCreating(false); }}
            onSaved={() => { setEditing(null); setCreating(false); reload(); }}
          />
        )}
      </main>
    </div>
  );
}

function ImportPanel({ token, kps, onDone }: { token: string; kps: Kp[]; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const template = JSON.stringify([
    {
      knowledge_point_slug: "demand",
      type: "basic",
      difficulty: 1,
      stem: "Question text in English…",
      option_a: "...",
      option_b: "...",
      option_c: "...",
      option_d: "...",
      correct_answer: "A",
      explanation: "中文解析…",
      pitfall_note: "易错提醒（可选）",
      term_tags: ["demand", "shift"],
      status: "published",
    },
  ], null, 2);

  async function importJson() {
    setBusy(true);
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error("应为 JSON 数组");
      const r = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ items: arr }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "导入失败");
      toast.success(`成功导入 ${j.inserted} 题`);
      setText("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          粘贴 JSON 数组进行批量导入。<code className="text-xs bg-muted px-1 py-0.5 rounded">knowledge_point_slug</code> 必须匹配已存在的知识点。
        </p>
        <details className="text-xs">
          <summary className="cursor-pointer text-primary">查看模板</summary>
          <pre className="mt-2 bg-muted p-3 rounded text-xs overflow-auto">{template}</pre>
        </details>
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="[{...}]" className="font-mono text-xs" />
        <Button onClick={importJson} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" /> 导入</>}
        </Button>
      </CardContent>
    </Card>
  );
}

function EditDialog({ kps, initial, token, onClose, onSaved }: {
  kps: Kp[]; initial: Q | null; token: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Q>>(initial ?? {
    knowledge_point_id: kps[0]?.id ?? "",
    type: "basic", difficulty: 1, stem: "",
    option_a: "", option_b: "", option_c: "", option_d: "",
    correct_answer: "A", explanation: "", pitfall_note: "",
    term_tags: [], status: "draft",
  });
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // 判断答案/选项是否相对原题发生变化（新建时始终视为已变化）
  function answerOrOptionsChanged(): boolean {
    if (!initial) return true;
    return (
      initial.correct_answer !== form.correct_answer ||
      initial.option_a !== form.option_a ||
      initial.option_b !== form.option_b ||
      initial.option_c !== form.option_c ||
      initial.option_d !== form.option_d ||
      initial.stem !== form.stem
    );
  }

  async function reanalyze(): Promise<{ explanation: string; pitfall_note: string } | null> {
    if (!form.stem || !form.option_a || !form.option_b || !form.option_c || !form.option_d || !form.correct_answer) {
      toast.error("请先补全题干、四个选项与正确答案");
      return null;
    }
    setAnalyzing(true);
    try {
      const r = await fetch("/api/admin/reanalyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          stem: form.stem,
          option_a: form.option_a,
          option_b: form.option_b,
          option_c: form.option_c,
          option_d: form.option_d,
          correct_answer: form.correct_answer,
          image_url: form.image_url ?? null,
        }),
      });
      const text = await r.text();
      let j: { explanation?: string; pitfall_note?: string; error?: string } = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch {
        // 网关返回的 504/HTML 等非 JSON
      }
      if (!r.ok) {
        if (r.status === 504) throw new Error("AI 响应超时，请重试或稍后再试");
        if (r.status === 429) throw new Error("调用过于频繁，请稍候再试");
        if (r.status === 402) throw new Error("AI 额度已用尽，请到设置中充值");
        throw new Error(j.error ?? `AI 分析失败 (${r.status})`);
      }
      const next = {
        explanation: j.explanation ?? form.explanation ?? "",
        pitfall_note: j.pitfall_note ?? "",
      };
      setForm((f) => ({ ...f, explanation: next.explanation, pitfall_note: next.pitfall_note }));
      toast.success("已重新生成解析");
      return next;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 分析失败");
      return null;
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      let payload = form;
      // 如果答案/选项/题干相对原题发生变化，先让 AI 重新生成解析
      if (initial && answerOrOptionsChanged()) {
        const ai = await reanalyze();
        if (ai) {
          payload = { ...form, explanation: ai.explanation, pitfall_note: ai.pitfall_note };
        }
      }
      const r = await fetch("/api/admin/questions", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("保存失败");
      toast.success("已保存");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 overflow-auto p-4">
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{initial ? "编辑题目" : "新建题目"}</h2>
              <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.knowledge_point_id} onValueChange={(v) => setForm({ ...form, knowledge_point_id: v })}>
                <SelectTrigger><SelectValue placeholder="知识点" /></SelectTrigger>
                <SelectContent>{kps.map((k) => <SelectItem key={k.id} value={k.id}>{k.name_zh}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as Q["type"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">基础</SelectItem>
                  <SelectItem value="application">应用</SelectItem>
                  <SelectItem value="pitfall">易错</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(form.difficulty)} onValueChange={(v) => setForm({ ...form, difficulty: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="难度" /></SelectTrigger>
                <SelectContent>{[1,2,3,4,5].map((n) => <SelectItem key={n} value={String(n)}>难度 {n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea rows={4} placeholder="题干（English）" value={form.stem ?? ""} onChange={(e) => setForm({ ...form, stem: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              {(["A","B","C","D"] as const).map((k) => (
                <Input key={k} placeholder={`选项 ${k}`} value={(form as any)[`option_${k.toLowerCase()}`] ?? ""}
                  onChange={(e) => setForm({ ...form, [`option_${k.toLowerCase()}`]: e.target.value })} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.correct_answer} onValueChange={(v) => setForm({ ...form, correct_answer: v as Q["correct_answer"] })}>
                <SelectTrigger><SelectValue placeholder="正确答案" /></SelectTrigger>
                <SelectContent>{["A","B","C","D"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Q["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="published">发布</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="术语标签（逗号分隔）"
                value={(form.term_tags ?? []).join(",")}
                onChange={(e) => setForm({ ...form, term_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {initial && answerOrOptionsChanged() ? (
                  <span className="text-warning-foreground">答案/选项/题干已变更，保存时将自动用 AI 重新生成解析</span>
                ) : (
                  <span>解析与易错提醒</span>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => reanalyze()} disabled={analyzing || busy}>
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI 重新分析
              </Button>
            </div>
            <Textarea rows={5} placeholder="官方解析（中文）" value={form.explanation ?? ""} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
            <Textarea rows={2} placeholder="易错提醒（可选）" value={form.pitfall_note ?? ""} onChange={(e) => setForm({ ...form, pitfall_note: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button onClick={save} disabled={busy || analyzing}>
                {busy || analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ImageUploadButton({ questionId, token, hasImage, onChanged }: {
  questionId: string; token: string; hasImage: boolean; onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("图片需小于 5MB");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("question_id", questionId);
      const r = await fetch("/api/admin/upload-image", {
        method: "POST",
        headers: { "x-admin-token": token },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "上传失败");
      toast.success("图片已保存");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeImage() {
    if (!confirm("移除已上传的图片？")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/upload-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ id: questionId }),
      });
      if (!r.ok) throw new Error();
      toast.success("已移除");
      onChanged();
    } catch {
      toast.error("移除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        size="sm"
        variant={hasImage ? "secondary" : "default"}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {hasImage ? "替换图" : "上传图"}
      </Button>
      {hasImage && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={removeImage} title="移除图片">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </>
  );
}

type Finding = {
  question_id: string;
  current_type: string;
  current_kp_slug: string;
  current_kp_zh: string;
  suggested_type?: string;
  suggested_kp_slug?: string;
  reason: string;
  stem_preview: string;
};

function AuditPanel({
  token,
  kps,
  questions,
  onApplied,
}: {
  token: string;
  kps: Kp[];
  questions: Q[];
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  async function runAudit() {
    setBusy(true);
    setFindings(null);
    try {
      const r = await fetch("/api/admin/audit", {
        method: "POST",
        headers: { "x-admin-token": token, "Content-Type": "application/json" },
      });
      const text = await r.text();
      let j: { findings?: Finding[]; total?: number; error?: string } = {};
      try {
        j = text ? JSON.parse(text) : {};
      } catch {
        // 网关 504/HTML
      }
      if (!r.ok) {
        if (r.status === 504) throw new Error("AI 响应超时，请重试");
        if (r.status === 429) throw new Error("调用过于频繁，请稍候再试");
        if (r.status === 402) throw new Error("AI 额度已用尽");
        throw new Error(j.error ?? `审核失败 (${r.status})`);
      }
      setFindings(j.findings ?? []);
      toast.success(`已审核 ${j.total ?? questions.length} 题，发现 ${j.findings?.length ?? 0} 条建议`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "审核失败");
    } finally {
      setBusy(false);
    }
  }

  async function applyOne(f: Finding) {
    setApplying(f.question_id);
    try {
      const payload: Record<string, unknown> = { id: f.question_id };
      if (f.suggested_type) payload.type = f.suggested_type;
      if (f.suggested_kp_slug) {
        const kp = kps.find((k) => k.slug === f.suggested_kp_slug);
        if (!kp) throw new Error(`未知知识点 slug：${f.suggested_kp_slug}`);
        payload.knowledge_point_id = kp.id;
      }
      const r = await fetch("/api/admin/questions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("应用失败");
      toast.success("已应用");
      setFindings((prev) => (prev ?? []).filter((x) => x.question_id !== f.question_id));
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "应用失败");
    } finally {
      setApplying(null);
    }
  }

  async function applyAll() {
    if (!findings || findings.length === 0) return;
    if (!confirm(`确认一次性应用 ${findings.length} 条建议？`)) return;
    for (const f of findings) {
      await applyOne(f);
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2 className="font-semibold">AI 题库分类审核</h2>
            <p className="text-sm text-muted-foreground mt-1">
              用 AI 重新核对每道题的题型（基础 / 应用 / 易错）与所属知识点。结果以建议形式列出，你可逐题确认或一键应用，不会自动覆盖。
            </p>
          </div>
          <Button onClick={runAudit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? "审核中…" : `开始审核（${questions.length} 题）`}
          </Button>
        </div>

        {findings && findings.length === 0 && (
          <div className="rounded-md bg-success/10 border border-success/30 px-4 py-3 text-sm text-success">
            ✓ 全部题目分类正确，无需修改。
          </div>
        )}

        {findings && findings.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">共 {findings.length} 条修改建议</span>
              <Button size="sm" variant="outline" onClick={applyAll} disabled={!!applying}>
                一键全部应用
              </Button>
            </div>
            <div className="space-y-2">
              {findings.map((f) => {
                const newKp = f.suggested_kp_slug ? kps.find((k) => k.slug === f.suggested_kp_slug) : null;
                return (
                  <Card key={f.question_id} className="border-warning/40">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-sm line-clamp-2">{f.stem_preview}</p>
                      <div className="text-xs space-y-1">
                        {f.suggested_type && (
                          <div>
                            <span className="text-muted-foreground">题型：</span>
                            <span className="line-through opacity-60 mr-1">{f.current_type}</span>
                            <span className="px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">
                              → {f.suggested_type}
                            </span>
                          </div>
                        )}
                        {f.suggested_kp_slug && (
                          <div>
                            <span className="text-muted-foreground">知识点：</span>
                            <span className="line-through opacity-60 mr-1">{f.current_kp_zh}</span>
                            <span className="px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">
                              → {newKp?.name_zh ?? f.suggested_kp_slug}
                            </span>
                          </div>
                        )}
                        <div className="text-muted-foreground">理由：{f.reason}</div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setFindings((prev) => (prev ?? []).filter((x) => x.question_id !== f.question_id))
                          }
                          disabled={applying === f.question_id}
                        >
                          忽略
                        </Button>
                        <Button size="sm" onClick={() => applyOne(f)} disabled={applying === f.question_id}>
                          {applying === f.question_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "应用"
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}