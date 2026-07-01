import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-tutor")({
  head: () => ({ meta: [{ title: "教师端｜试课预约管理" }] }),
  component: AdminTutorPage,
});

type Row = {
  id: string;
  user_id: string;
  teacher: string;
  scheduled_at: string | null;
  preferred_time: string | null;
  contact: string | null;
  note: string | null;
  status: string;
  created_at: string;
  email?: string;
  display_name?: string | null;
};

function statusBadge(status: string) {
  if (status === "completed") return <Badge variant="secondary">已完成</Badge>;
  if (status === "cancelled") return <Badge variant="outline">已取消</Badge>;
  return <Badge>待上课</Badge>;
}

function AdminTutorPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [day, setDay] = useState<Date>(new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate({ to: "/auth" }); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user, authLoading, navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const { data: bookings, error } = await supabase
      .from("tutor_trial_bookings")
      .select("id, user_id, teacher, scheduled_at, preferred_time, contact, note, status, created_at")
      .or(`and(scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),and(scheduled_at.is.null,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})`)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const ids = Array.from(new Set((bookings ?? []).map((b) => b.user_id)));
    let profiles: Record<string, { email: string; display_name: string | null }> = {};
    if (ids.length) {
      const { data: pr } = await supabase
        .from("profiles")
        .select("user_id, email, display_name")
        .in("user_id", ids);
      (pr ?? []).forEach((p) => { profiles[p.user_id] = { email: p.email, display_name: p.display_name }; });
    }
    setRows(((bookings ?? []) as Row[]).map((b) => ({ ...b, email: profiles[b.user_id]?.email, display_name: profiles[b.user_id]?.display_name ?? null })));
    setLoading(false);
  }, [day, isAdmin]);

  useEffect(() => { load(); }, [load]);

  async function markCompleted(id: string) {
    const { error } = await supabase
      .from("tutor_trial_bookings")
      .update({ status: "completed" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "completed" } : r)));
    toast.success("已标记为完成");
  }

  async function reopen(id: string) {
    const { error } = await supabase
      .from("tutor_trial_bookings")
      .update({ status: "booked" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "booked" } : r)));
  }

  if (authLoading || isAdmin === null) {
    return <div className="container py-8 text-sm text-muted-foreground">加载中...</div>;
  }
  if (!isAdmin) {
    return (
      <div className="container py-8 space-y-3">
        <h1 className="text-xl font-bold">仅限教师/管理员访问</h1>
        <p className="text-sm text-muted-foreground">你没有权限查看该页面。</p>
        <Button asChild variant="outline"><Link to="/">返回首页</Link></Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">教师端 · 试课预约</h1>
          <p className="text-sm text-muted-foreground mt-1">查看选定日期的所有试课预约，并标记完成。</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {format(day, "yyyy-MM-dd")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar mode="single" selected={day} onSelect={(d) => d && setDay(d)} />
          </PopoverContent>
        </Popover>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">当日没有预约。</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {r.teacher} · {r.scheduled_at ? format(new Date(r.scheduled_at), "HH:mm") : (r.preferred_time || "未指定")}
                </CardTitle>
                {statusBadge(r.status)}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">学生：</span>
                  {r.display_name || r.email || r.user_id}
                  {r.email && r.display_name ? <span className="text-muted-foreground ml-2">({r.email})</span> : null}
                </div>
                {r.contact && <div><span className="text-muted-foreground">联系方式：</span>{r.contact}</div>}
                {r.note && <div><span className="text-muted-foreground">备注：</span>{r.note}</div>}
                <div className="text-xs text-muted-foreground">
                  提交时间：{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                </div>
                <div className="pt-2 flex gap-2">
                  {r.status !== "completed" ? (
                    <Button size="sm" onClick={() => markCompleted(r.id)}>标记已完成</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => reopen(r.id)}>撤销完成</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}