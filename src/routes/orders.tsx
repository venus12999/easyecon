import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Receipt, Crown, Loader2, Sparkles } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "我的订单 · EasyEcon" },
      { name: "description", content: "查看你在 EasyEcon 的最近订单、课程包与会员权益状态。" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

type TutorOrder = {
  id: string;
  paddle_transaction_id: string;
  price_external_id: string;
  quantity: number;
  amount_total: number | null;
  currency_code: string | null;
  status: string;
  membership_days_granted: number;
  membership_ends_at: string | null;
  created_at: string;
};

type MembershipAdj = {
  id: string;
  days_granted: number;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

const PLAN_LABEL: Record<string, string> = {
  tutor_pack_10: "10 节核心突破课",
  tutor_pack_30: "30 节满分包",
  tutor_single_lesson: "单节续费课",
};

function statusLabel(s: string) {
  if (s === "completed" || s === "paid") return { text: "已完成", tone: "default" as const };
  if (s === "refunded") return { text: "已退款", tone: "destructive" as const };
  if (s === "past_due") return { text: "待付款", tone: "secondary" as const };
  if (s === "canceled") return { text: "已取消", tone: "outline" as const };
  return { text: s, tone: "secondary" as const };
}

function OrdersPage() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<TutorOrder[]>([]);
  const [adjustments, setAdjustments] = useState<MembershipAdj[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [o, a] = await Promise.all([
        supabase.from("tutor_orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("membership_adjustments").select("id, days_granted, starts_at, ends_at, note").eq("user_id", user.id).order("starts_at", { ascending: false }).limit(20),
      ]);
      if (cancelled) return;
      setOrders((o.data as TutorOrder[] | null) ?? []);
      setAdjustments((a.data as MembershipAdj[] | null) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading) {
    return <div className="mx-auto flex max-w-3xl items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">我的订单</h1>
        <p className="mt-3 text-muted-foreground">请先登录查看你的订单与购买记录。</p>
        <Button asChild className="mt-6"><Link to="/auth">去登录</Link></Button>
      </main>
    );
  }

  const activeAdj = adjustments.find((a) => new Date(a.ends_at) > new Date());

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Receipt className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的订单</h1>
          <p className="text-sm text-muted-foreground">查看最近的辅导课购买记录与赠送的会员权益</p>
        </div>
      </header>

      {/* Membership summary */}
      <Card className="mb-6 border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Crown className="h-4 w-4 text-primary" />会员权益</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {activeAdj ? (
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>购买赠送的 Pro 会员生效中，到期时间：</span>
              <span className="font-semibold">{format(new Date(activeAdj.ends_at), "yyyy-MM-dd")}</span>
            </div>
          ) : (
            <div className="text-muted-foreground">当前没有由订单赠送、仍在生效的会员权益。</div>
          )}
        </CardContent>
      </Card>

      {/* Orders list */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有订单。去<Link to="/tutor" className="mx-1 text-primary underline">五分大神带你飞</Link>看看课程包。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const s = statusLabel(o.status);
            const label = PLAN_LABEL[o.price_external_id] ?? o.price_external_id;
            const isRenewal = o.price_external_id === "tutor_single_lesson";
            const renewalActive = isRenewal && o.membership_days_granted > 0
              && o.membership_ends_at && new Date(o.membership_ends_at) > new Date();
            return (
              <Card key={o.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{label}</span>
                      {isRenewal && <Badge variant="outline">续费 · {o.quantity} 节</Badge>}
                      <Badge variant={s.tone}>{s.text}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {format(new Date(o.created_at), "yyyy-MM-dd HH:mm")} · 订单号 {o.paddle_transaction_id.slice(0, 12)}…
                    </div>
                    {o.membership_days_granted > 0 && (
                      <div className="mt-1 text-xs text-primary">
                        🎁 赠送 Pro 会员 {o.membership_days_granted} 天
                        {o.membership_ends_at && ` · 至 ${format(new Date(o.membership_ends_at), "yyyy-MM-dd")}`}
                        {isRenewal && (renewalActive ? "（续费生效中）" : "（已结束）")}
                      </div>
                    )}
                    {isRenewal && o.membership_days_granted === 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">未达赠送门槛（购满 5 节自动赠送 2 周会员）</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">
                      {o.amount_total != null ? `${o.currency_code === "CNY" ? "¥" : ""}${o.amount_total.toFixed(2)}` : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">共 {o.quantity} 节</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        订单由 Paddle 处理。如需退款或查看发票，请前往你的注册邮箱查看 Paddle 邮件，或
        <Link to="/legal/refunds" className="mx-1 text-primary underline">查看退款政策</Link>。
      </p>
    </main>
  );
}
