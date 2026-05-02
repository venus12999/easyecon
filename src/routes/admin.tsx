import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload, Image as ImageIcon, Sparkles, Inbox } from "lucide-react";

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
  option_e: string | null;
  correct_answer: "A" | "B" | "C" | "D" | "E";
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
  const [filterUnit, setFilterUnit] = useState<string>("all");
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
    if (filterUnit !== "all") {
      const kp = kps.find((k) => k.id === q.knowledge_point_id);
      if (!kp || String(kp.unit) !== filterUnit) return false;
    }
    if (filterKp !== "all" && q.knowledge_point_id !== filterKp) return false;
    if (filterType !== "all" && q.type !== filterType) return false;
    if (filterImage === "image" && !hasImageMarker(q.stem)) return false;
    if (filterImage === "noimage" && hasImageMarker(q.stem)) return false;
    if (search && !q.stem.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const imageCount = questions.filter((q) => hasImageMarker(q.stem)).length;
  const units = Array.from(new Set(kps.map((k) => k.unit))).sort((a, b) => a - b);
  const visibleKps = filterUnit === "all" ? kps : kps.filter((k) => String(k.unit) === filterUnit);

  return (
    <div className="min-h-screen bg-background">
      
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
            <TabsTrigger value="feedback">用户反馈</TabsTrigger>
            <TabsTrigger value="users">用户数据</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <Select value={filterUnit} onValueChange={(v) => { setFilterUnit(v); setFilterKp("all"); }}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部单元</SelectItem>
                  {units.map((u) => <SelectItem key={u} value={String(u)}>Unit {u}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterKp} onValueChange={setFilterKp}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部知识点</SelectItem>
                  {visibleKps.map((k) => <SelectItem key={k.id} value={k.id}>{k.name_zh}</SelectItem>)}
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

          <TabsContent value="feedback" className="mt-4">
            <FeedbackPanel token={token} />
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <UsersPanel token={token} />
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
    option_a: "", option_b: "", option_c: "", option_d: "", option_e: "",
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
      (initial.option_e ?? "") !== (form.option_e ?? "") ||
      initial.stem !== form.stem
    );
  }

  async function reanalyze(): Promise<{ explanation: string; pitfall_note: string } | null> {
    if (!form.stem || !form.option_a || !form.option_b || !form.option_c || !form.option_d || !form.correct_answer) {
      toast.error("请先补全题干、A–D 选项与正确答案（E 选项可选）");
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
          option_e: form.option_e ?? null,
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
              {(["A","B","C","D","E"] as const).map((k) => (
                <Input key={k} placeholder={`选项 ${k}${k === "E" ? "（可选）" : ""}`} value={(form as any)[`option_${k.toLowerCase()}`] ?? ""}
                  onChange={(e) => setForm({ ...form, [`option_${k.toLowerCase()}`]: e.target.value })} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.correct_answer} onValueChange={(v) => setForm({ ...form, correct_answer: v as Q["correct_answer"] })}>
                <SelectTrigger><SelectValue placeholder="正确答案" /></SelectTrigger>
                <SelectContent>{["A","B","C","D","E"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
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
  confidence: number;
  key_evidence?: string;
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function runAudit() {
    setBusy(true);
    setFindings(null);
    setProgress({ done: 0, total: questions.length });
    try {
      // 前端分批：每批 6 题，单个 HTTP 请求保持在网关超时之下
      const BATCH = 6;
      const all: Finding[] = [];
      for (let i = 0; i < questions.length; i += BATCH) {
        const slice = questions.slice(i, i + BATCH).map((q) => q.id);
        const r = await fetch("/api/admin/audit", {
          method: "POST",
          headers: { "x-admin-token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ question_ids: slice }),
        });
        const text = await r.text();
        let j: { findings?: Finding[]; error?: string } = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch {
          /* HTML / 504 */
        }
        if (!r.ok) {
          if (r.status === 504) throw new Error(`第 ${Math.floor(i / BATCH) + 1} 批 AI 响应超时，请稍后重试`);
          if (r.status === 429) throw new Error("调用过于频繁，请稍候再试");
          if (r.status === 402) throw new Error("AI 额度已用尽");
          throw new Error(j.error ?? `审核失败 (${r.status})`);
        }
        if (j.findings) all.push(...j.findings);
        setProgress({ done: Math.min(i + BATCH, questions.length), total: questions.length });
        setFindings([...all]);
      }
      toast.success(`已审核 ${questions.length} 题，发现 ${all.length} 条建议`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "审核失败");
    } finally {
      setBusy(false);
      setProgress(null);
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
            {busy
              ? progress
                ? `审核中 ${progress.done}/${progress.total}…`
                : "审核中…"
              : `开始审核（${questions.length} 题）`}
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
                const conf = Math.max(1, Math.min(5, f.confidence ?? 4));
                const confTone =
                  conf >= 5
                    ? "bg-destructive/15 text-destructive border-destructive/30"
                    : "bg-warning/15 text-warning border-warning/30";
                // 在题干预览中高亮 AI 给出的关键证据短语
                const evidence = f.key_evidence?.trim();
                let stemNode: React.ReactNode = f.stem_preview;
                if (evidence && f.stem_preview.toLowerCase().includes(evidence.toLowerCase())) {
                  const idx = f.stem_preview.toLowerCase().indexOf(evidence.toLowerCase());
                  stemNode = (
                    <>
                      {f.stem_preview.slice(0, idx)}
                      <mark className="bg-warning/30 text-foreground rounded px-0.5">
                        {f.stem_preview.slice(idx, idx + evidence.length)}
                      </mark>
                      {f.stem_preview.slice(idx + evidence.length)}
                    </>
                  );
                }
                return (
                  <Card key={f.question_id} className="border-warning/40">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm line-clamp-2 flex-1">{stemNode}</p>
                        <span
                          className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border font-medium ${confTone}`}
                          title="AI 置信度（仅展示 ≥4 的建议）"
                        >
                          置信度 {conf}/5
                        </span>
                      </div>
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
                        {evidence && (
                          <div>
                            <span className="text-muted-foreground">关键依据：</span>
                            <mark className="bg-warning/30 text-foreground rounded px-1 py-0.5">
                              {evidence}
                            </mark>
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

type FeedbackItem = {
  id: string;
  category: "bug" | "suggestion";
  message: string;
  page_url: string | null;
  contact: string | null;
  status: "new" | "in_progress" | "resolved";
  admin_note: string | null;
  created_at: string;
};

function FeedbackPanel({ token }: { token: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "in_progress" | "resolved">("all");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/feedback", { headers: { "x-admin-token": token } });
      const j = await r.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = items.filter((i) => filter === "all" || i.status === filter);
  const newCount = items.filter((i) => i.status === "new").length;

  async function update(id: string, patch: Partial<Pick<FeedbackItem, "status" | "admin_note">>) {
    const r = await fetch("/api/admin/feedback", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ id, ...patch }),
    });
    if (r.ok) {
      toast.success("已更新");
      reload();
    } else toast.error("更新失败");
  }

  async function remove(id: string) {
    if (!confirm("确认删除？")) return;
    const r = await fetch("/api/admin/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      toast.success("已删除");
      reload();
    } else toast.error("删除失败");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">
          共 {items.length} 条 · 未处理 <b className="text-warning-foreground">{newCount}</b>
        </span>
        <div className="ml-auto flex gap-1">
          {(["all", "new", "in_progress", "resolved"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "全部" : s === "new" ? "未处理" : s === "in_progress" ? "处理中" : "已解决"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={reload} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "刷新"}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无反馈</p>
      ) : (
        <div className="space-y-3">
          {visible.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      f.category === "bug"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {f.category === "bug" ? "🐞 Bug" : "💡 建议"}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      f.status === "new"
                        ? "bg-warning/15 text-warning-foreground"
                        : f.status === "in_progress"
                        ? "bg-secondary"
                        : "bg-success/15 text-success"
                    }`}
                  >
                    {f.status === "new" ? "未处理" : f.status === "in_progress" ? "处理中" : "已解决"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                  {f.page_url && (
                    <span className="text-muted-foreground truncate">来自 {f.page_url}</span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{f.message}</p>
                {f.contact && (
                  <p className="text-xs text-muted-foreground">联系方式：{f.contact}</p>
                )}
                <Textarea
                  placeholder="处理备注（仅自己可见）"
                  defaultValue={f.admin_note ?? ""}
                  rows={2}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (f.admin_note ?? "")) update(f.id, { admin_note: v });
                  }}
                />
                <div className="flex gap-2">
                  {f.status !== "in_progress" && (
                    <Button size="sm" variant="outline" onClick={() => update(f.id, { status: "in_progress" })}>
                      标记处理中
                    </Button>
                  )}
                  {f.status !== "resolved" && (
                    <Button size="sm" onClick={() => update(f.id, { status: "resolved" })}>
                      标记已解决
                    </Button>
                  )}
                  {f.status !== "new" && (
                    <Button size="sm" variant="ghost" onClick={() => update(f.id, { status: "new" })}>
                      重置
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => remove(f.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
function UsersPanel({ token }: { token: string }) {
  type U = { user_id: string; email: string; display_name: string | null; created_at: string; total: number; correct: number; last: string | null; mocks: number };
  type Detail = {
    profile: { email: string; created_at: string } | null;
    attempts: Array<{ id: string; question_id: string; picked_answer: string | null; is_correct: boolean; mode: string; created_at: string }>;
    mocks: Array<{ id: string; total: number; correct: number; duration_seconds: number; created_at: string }>;
    wrongs: Array<{ question_id: string; added_at: string }>;
    questions: Record<string, { stem: string; correct_answer: string }>;
  };
  const [users, setUsers] = useState<U[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users", { headers: { "x-admin-token": token } })
      .then((r) => r.json())
      .then((j) => { setUsers(j.users ?? []); setLoading(false); });
  }, [token]);

  async function open(uid: string) {
    setPicked(uid);
    setDetail(null);
    const r = await fetch(`/api/admin/users?user_id=${uid}`, { headers: { "x-admin-token": token } });
    setDetail(await r.json());
  }

  if (loading) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-2">注册用户（{users.length}）</div>
          <div className="space-y-1 max-h-[70vh] overflow-auto">
            {users.map((u) => (
              <button
                key={u.user_id}
                onClick={() => open(u.user_id)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-accent ${picked === u.user_id ? "bg-accent" : ""}`}
              >
                <div className="font-medium truncate">{u.email}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  答题 {u.total} · 正确 {u.total ? Math.round((u.correct / u.total) * 100) : 0}% · 模考 {u.mocks}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  注册 {new Date(u.created_at).toLocaleDateString()} · 最近 {u.last ? new Date(u.last).toLocaleString() : "—"}
                </div>
              </button>
            ))}
            {users.length === 0 && <div className="text-xs text-muted-foreground">暂无注册用户</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {!picked && <div className="text-sm text-muted-foreground">选择一个用户查看明细</div>}
          {picked && !detail && <div className="text-sm text-muted-foreground">加载中…</div>}
          {detail && (
            <Tabs defaultValue="attempts">
              <div className="mb-3">
                <div className="font-medium">{detail.profile?.email}</div>
                <div className="text-xs text-muted-foreground">注册于 {detail.profile && new Date(detail.profile.created_at).toLocaleString()}</div>
              </div>
              <TabsList>
                <TabsTrigger value="attempts">答题明细 ({detail.attempts.length})</TabsTrigger>
                <TabsTrigger value="mocks">模考记录 ({detail.mocks.length})</TabsTrigger>
                <TabsTrigger value="wrongs">错题 ({detail.wrongs.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="attempts" className="mt-3 max-h-[60vh] overflow-auto space-y-2">
                {detail.attempts.map((a) => {
                  const q = detail.questions[a.question_id];
                  return (
                    <div key={a.id} className="border rounded px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded ${a.is_correct ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                          {a.is_correct ? "✓" : "✗"}
                        </span>
                        <span className="text-muted-foreground">{a.mode}</span>
                        <span className="text-muted-foreground ml-auto">{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                      <div className="line-clamp-2">{q?.stem ?? "(题目已删除)"}</div>
                      <div className="text-muted-foreground mt-1">选 {a.picked_answer ?? "—"} · 正确 {q?.correct_answer ?? "?"}</div>
                    </div>
                  );
                })}
              </TabsContent>
              <TabsContent value="mocks" className="mt-3 space-y-2 max-h-[60vh] overflow-auto">
                {detail.mocks.map((m) => (
                  <div key={m.id} className="border rounded px-3 py-2 text-sm flex justify-between">
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                    <span>{m.correct}/{m.total} · {Math.round((m.correct/m.total)*100)}% · {Math.floor(m.duration_seconds/60)}分{m.duration_seconds%60}秒</span>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="wrongs" className="mt-3 space-y-2 max-h-[60vh] overflow-auto">
                {detail.wrongs.map((w) => (
                  <div key={w.question_id} className="border rounded px-3 py-2 text-xs">
                    <div className="line-clamp-2">{detail.questions[w.question_id]?.stem ?? "(题目已删除)"}</div>
                    <div className="text-muted-foreground mt-1">加入于 {new Date(w.added_at).toLocaleString()}</div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
