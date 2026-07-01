import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/tutor-bookings")({
  head: () => ({ meta: [{ title: "我的试课预约" }] }),
  component: MyBookingsPage,
});

type Booking = {
  id: string;
  teacher: string;
  scheduled_at: string | null;
  preferred_time: string | null;
  contact: string | null;
  note: string | null;
  status: string;
  created_at: string;
};

function statusBadge(status: string) {
  if (status === "completed") return <Badge variant="secondary">已完成</Badge>;
  if (status === "cancelled") return <Badge variant="outline">已取消</Badge>;
  return <Badge>已预约</Badge>;
}

function MyBookingsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("tutor_trial_bookings")
        .select("id, teacher, scheduled_at, preferred_time, contact, note, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) toast.error(error.message);
      else setRows((data ?? []) as Booking[]);
      setLoading(false);
    })();
  }, [user, authLoading, navigate]);

  async function cancel(id: string) {
    if (!confirm("确认取消该预约？取消后无法恢复。")) return;
    const { error } = await supabase
      .from("tutor_trial_bookings")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)));
    toast.success("已取消");
  }

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的试课预约</h1>
          <p className="text-sm text-muted-foreground mt-1">查看你的免费试课预约状态。</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/tutor">返回辅导</Link></Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            你还没有预约任何试课。<Link to="/tutor" className="text-primary ml-1 underline">立即预约</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{r.teacher} 老师</CardTitle>
                {statusBadge(r.status)}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">日期时间：</span>
                  {r.scheduled_at
                    ? format(new Date(r.scheduled_at), "yyyy-MM-dd HH:mm")
                    : r.preferred_time || "未指定"}
                </div>
                {r.contact && (
                  <div><span className="text-muted-foreground">联系方式：</span>{r.contact}</div>
                )}
                {r.note && (
                  <div><span className="text-muted-foreground">备注：</span>{r.note}</div>
                )}
                <div className="text-xs text-muted-foreground">
                  提交时间：{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                </div>
                {r.status === "booked" && (
                  <div className="pt-2">
                    <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>取消预约</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}