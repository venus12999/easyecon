import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PAY_PLANS } from "@/lib/pay-plans";

type Row = {
  id: string;
  order_no: string;
  user_id: string;
  userLabel: string;
  kind: string;
  plan_key: string;
  quantity: number;
  amount_cny: number;
  channel: string;
  status: string;
  payer_note: string | null;
  review_note: string | null;
  proofUrl: string | null;
  created_at: string;
};

export function ManualPaymentsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/manual-payments", { headers: { Authorization: `Bearer ${token}` } });
    const json = res.ok ? ((await res.json()) as { items: Row[] }) : { items: [] };
    setRows(json.items ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function review(row: Row, action: "approve" | "reject") {
    const reviewNote = action === "reject" ? window.prompt("驳回原因（会展示给用户）") ?? "" : "";
    if (action === "reject" && !reviewNote.trim()) return;
    setBusy(row.id);
    const res = await fetch("/api/admin/manual-payments", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: row.id, action, reviewNote }),
    });
    setBusy(null);
    if (!res.ok) return toast.error("操作失败");
    toast.success(action === "approve" ? "已通过并开通权益" : "已驳回");
    void load();
  }

  const keyword = search.trim().toLowerCase();
  const visible = keyword
    ? rows.filter((r) => r.userLabel.toLowerCase().includes(keyword) || r.order_no.toLowerCase().includes(keyword))
    : rows;
  const pending = visible.filter((r) => r.status === "pending");
  const others = visible.filter((r) => r.status !== "pending");

  if (loading) return <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" />;

  function renderRow(row: Row) {
    return (
      <Card key={row.id}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{PAY_PLANS[row.plan_key as keyof typeof PAY_PLANS]?.label ?? row.plan_key}</span>
              {row.quantity > 1 && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.quantity} 节</span>}
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.channel === "wechat" ? "微信" : "支付宝"}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${row.status === "approved" ? "bg-success/15 text-success" : row.status === "rejected" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning-foreground"}`}>
                {row.status === "approved" ? "已通过" : row.status === "rejected" ? "已驳回" : "待审核"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {row.userLabel} · 订单号 {row.order_no} · {new Date(row.created_at).toLocaleString()}
            </div>
            <div className="font-semibold">¥{Number(row.amount_cny).toFixed(2)}</div>
            {row.payer_note && <div className="text-xs text-muted-foreground">用户备注：{row.payer_note}</div>}
            {row.review_note && <div className="text-xs text-destructive">审核备注：{row.review_note}</div>}
            {row.proofUrl && (
              <a href={row.proofUrl} target="_blank" rel="noreferrer">
                <img src={row.proofUrl} alt="付款截图" className="mt-2 max-h-40 rounded border object-contain" />
              </a>
            )}
          </div>
          {row.status === "pending" && (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === row.id} onClick={() => void review(row, "approve")}>通过并开通</Button>
              <Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => void review(row, "reject")}>驳回</Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="搜索用户或订单号…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Button size="sm" variant="outline" onClick={() => void load()}>刷新</Button>
        <span className="ml-auto text-sm text-muted-foreground">待审核 {pending.length} 笔</span>
      </div>
      {pending.length === 0 && others.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">暂无扫码付款记录。</p>
      ) : (
        <>
          {pending.length > 0 && <div className="space-y-2">{pending.map(renderRow)}</div>}
          {others.length > 0 && (
            <>
              <div className="pt-2 text-xs font-semibold text-muted-foreground">已处理（{others.length}）</div>
              <div className="space-y-2">{others.map(renderRow)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}