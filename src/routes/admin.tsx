import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Upload, Image as ImageIcon } from "lucide-react";

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
                      </div>
                      <p className="text-sm line-clamp-2">{q.stem}</p>
                    </div>
                    <div className="flex gap-2">
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

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/questions", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify(form),
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
            <Textarea rows={5} placeholder="官方解析（中文）" value={form.explanation ?? ""} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
            <Textarea rows={2} placeholder="易错提醒（可选）" value={form.pitfall_note ?? ""} onChange={(e) => setForm({ ...form, pitfall_note: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}