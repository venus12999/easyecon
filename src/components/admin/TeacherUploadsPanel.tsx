import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { examSlugFromFilename } from "@/lib/ap-exam-parse";

function suggestedSlug(row: UploadRow | undefined, titleOverride?: string) {
  const fromTitle = examSlugFromFilename(titleOverride || row?.paper?.title || "");
  if (/^ap-micro-20\d{2}$/.test(fromTitle)) return fromTitle;
  return examSlugFromFilename(row?.filename || fromTitle);
}

type UploadRow = {
  id: string;
  filename: string;
  page_count: number;
  created_at: string;
  mcq: number;
  frq: number;
  thumb: string | null;
  promote_requested: boolean;
  in_mock_library: boolean;
  paper: { id: string; slug: string; title: string; year: number | null; description: string | null } | null;
};

export function TeacherUploadsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [titleById, setTitleById] = useState<Record<string, string>>({});
  const [slugById, setSlugById] = useState<Record<string, string>>({});
  const [practiceById, setPracticeById] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/teacher-uploads", { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? "无法加载教师上传");
        setRows([]);
        return;
      }
      setRows(j.uploads ?? []);
    } catch {
      toast.error("无法加载教师上传");
      setRows([]);
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  async function act(id: string, action: "promote" | "keep-school") {
    const row = rows?.find((x) => x.id === id);
    setBusy(id + action);
    const r = await fetch("/api/admin/teacher-uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        import_id: id,
        title: titleById[id] || row?.paper?.title,
        slug: slugById[id] || suggestedSlug(row, titleById[id]),
        into_practice: !!practiceById[id],
      }),
    });
    const j = await r.json();
    setBusy("");
    if (!r.ok) {
      toast.error(j.error ?? "操作失败");
      return;
    }
    toast.success(
      action === "promote"
        ? `已列入模拟考试：${j.paper?.title}${j.replaced ? `（已替换「${j.replaced}」）` : ""}`
        : "已保留为学校考试卷",
    );
    await reload();
  }

  if (!rows) {
    return <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8">还没有教师提交的 PDF 卷。老师在 /teacher → PDF 出题里上传并校对发布后，会出现在这里。</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        教师上传的试卷会先保存在后台。默认只给该老师布置学校考试用，不会进入 /mock、选择题或大题练习库。点「列入模拟考试」后学生才能在真题卷库看到。
      </p>
      {rows.map((row) => {
        const title = titleById[row.id] ?? row.paper?.title ?? row.filename;
        const slug = slugById[row.id] ?? suggestedSlug(row, titleById[row.id]);
        return (
          <Card key={row.id} className="overflow-hidden">
            <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
              {row.thumb ? (
                <img src={row.thumb} alt="" className="w-full sm:w-36 h-44 object-cover rounded-lg border" />
              ) : (
                <div className="w-full sm:w-36 h-24 rounded-lg bg-muted" />
              )}
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium truncate">{row.paper?.title ?? row.filename}</h3>
                  {row.in_mock_library && <span className="text-[11px] px-1.5 py-0.5 rounded bg-success/15 text-success">已在模拟考试库</span>}
                  {row.promote_requested && !row.in_mock_library && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground">申请列入真题库</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.mcq} 道选择题 · {row.frq} 道大题 · {row.page_count} 页 · {new Date(row.created_at).toLocaleString()}
                  {row.paper ? ` · 当前卷号 ${row.paper.slug}` : ""}
                </p>
                {!row.in_mock_library && (
                  <>
                    <Input
                      value={title}
                      onChange={(e) => setTitleById((m) => ({ ...m, [row.id]: e.target.value }))}
                      placeholder="列入真题库后的标题"
                    />
                    <Input
                      value={slug}
                      onChange={(e) => setSlugById((m) => ({ ...m, [row.id]: e.target.value.trim() }))}
                      placeholder="卷号，例如 ap-micro-2022"
                    />
                    <p className="text-[11px] text-muted-foreground">学生会在 /mock 看到这份卷。默认仍不进入日常选择题/大题库。</p>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={!!practiceById[row.id]}
                        onChange={(e) => setPracticeById((m) => ({ ...m, [row.id]: e.target.checked }))}
                      />
                      同时进入日常选择题/大题练习库（一般不要勾）
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={!!busy} onClick={() => void act(row.id, "promote")}>
                        {busy === `${row.id}promote` ? "处理中…" : "列入模拟考试真题库"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(row.id, "keep-school")}>
                        仅保留学校考试
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
