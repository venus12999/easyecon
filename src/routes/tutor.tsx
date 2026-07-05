import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, GraduationCap, Sparkles, Users, Video, Gift } from "lucide-react";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import venusAvatar from "@/assets/venus-avatar.jpeg.asset.json";


const TIME_SLOTS = ["10:00", "14:00", "16:00", "19:00", "20:00", "21:00"];

function toSlotISO(day: Date, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export const Route = createFileRoute("/tutor")({
  head: () => ({
    meta: [
      { title: "五分大神带你飞｜AP 微观经济一对一线上辅导" },
      { name: "description", content: "由 AP 微观经济 5 分学长学姐提供的一对一线上辅导课程，帮助你冲刺满分。" },
      { property: "og:title", content: "五分大神带你飞 · 1v1 在线辅导" },
      { property: "og:description", content: "订阅 5 分大神的一对一直播辅导，快速攻克难点、模考讲评、FRQ 精讲。" },
    ],
  }),
  component: TutorPage,
});

type Plan = {
  id: "tutor_pack_10" | "tutor_pack_30" | "tutor_single_lesson";
  name: string;
  price: string;
  unit: string;
  desc: string;
  perks: string[];
  highlight?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    id: "tutor_pack_10",
    name: "10 节核心突破课",
    price: "¥800",
    unit: "/ 10 节 · 60 分钟/节",
    desc: "聚焦高频考点、易错点与典型 FRQ，配合 1 套整卷模考讲评，精准提升。",
    perks: ["1v1 视频直播 10 节", "重点单元 & 典型真题精讲", "1 套模考全卷讲评", "赠送 Pro 会员 1 个月"],
    highlight: true,
    badge: "推荐",
  },
  {
    id: "tutor_single_lesson",
    name: "单节续费课",
    price: "¥120",
    unit: "/ 1 节 · 60 分钟",
    desc: "已上过课的同学专属续费价，按节加购，随需随约；一次买 5 节及以上额外赠送 Pro 会员 2 周。",
    perks: ["1v1 视频直播 · 自定义节数", "老师延续你的学习进度", "灵活加课，按需补强", "购满 5 节送 Pro 会员 2 周"],
    badge: "老学员续费",
  },
  {
    id: "tutor_pack_30",
    name: "30 节满分包",
    price: "¥3200",
    unit: "/ 30 节 · 60 分钟/节",
    desc: "系统覆盖全部 6 个 Unit 精讲 + 多套整卷模考讲评，冲刺 5 分。",
    perks: ["1v1 视频直播 30 节", "6 个 Unit 全套精讲", "多套模考全卷讲评 + FRQ 精讲", "赠送 Pro 会员 3 个月"],
    badge: "满分包",
  },
];

const TEACHERS = [
  {
    name: "Steve",
    title: "十一年级在读学长 · 沉稳内敛",
    desc: "他不会直接告诉你\"应该背什么\"，而是陪你把每一个难点真正弄懂。",
    motto: "逸一时，误一世。",
    avatar: null,
  },
  {
    name: "Venus",
    title: "十一年级在读学姐 · 激情鲜活",
    desc: "喜欢把经济学讲\"活\"，擅长用商业案例和生活中的真实场景讲清楚复杂的 AP Micro 概念。",
    motto: "希望每一节课结束，你都会觉得：\"原来 AP Micro 可以这么简单。\"",
    avatar: venusAvatar.url,
  },
];


function TutorPage() {
  const { user } = useAuth();
  const { openCheckout, loading } = usePaddleCheckout();
  const [existingBooking, setExistingBooking] = useState<{ teacher: string; created_at: string; scheduled_at: string | null } | null>(null);
  const [checking, setChecking] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qty, setQty] = useState<number>(1);
  const [form, setForm] = useState<{ teacher: string; date: Date | undefined; slot: string; contact: string; note: string }>({
    teacher: "Steve", date: undefined, slot: "", contact: "", note: "",
  });
  const [takenSlots, setTakenSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tutor_trial_bookings")
        .select("teacher, created_at, scheduled_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setExistingBooking(data ?? null);
        setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Fetch taken slots whenever teacher or date changes.
  useEffect(() => {
    if (!dialogOpen || !form.date) { setTakenSlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    (async () => {
      const dayStr = format(form.date as Date, "yyyy-MM-dd");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `/api/tutor/taken-slots?teacher=${encodeURIComponent(form.teacher)}&day=${dayStr}`,
          { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} },
        );
        if (cancelled) return;
        if (!res.ok) { setTakenSlots([]); }
        else {
          const json = await res.json() as { slots?: string[] };
          const taken = (json.slots ?? []).map((s) => {
            const d = new Date(s);
            return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          });
          setTakenSlots(taken);
        }
      } catch {
        if (!cancelled) setTakenSlots([]);
      }
      if (!cancelled) setLoadingSlots(false);
    })();
    return () => { cancelled = true; };
  }, [form.teacher, form.date, dialogOpen]);

  function openBookingFor(teacher: string) {
    if (!user) { toast.error("请先登录"); return; }
    if (existingBooking) { toast.info("你已使用过免费试课"); return; }
    setForm({ teacher, date: undefined, slot: "", contact: "", note: "" });
    setDialogOpen(true);
  }

  async function submitTrial() {
    if (!user) { toast.error("请先登录"); return; }
    if (!form.contact.trim()) { toast.error("请填写联系方式，方便老师联系你排课"); return; }
    if (!form.date) { toast.error("请选择上课日期"); return; }
    if (!form.slot) { toast.error("请选择时间段"); return; }
    const scheduledISO = toSlotISO(form.date, form.slot);
    if (new Date(scheduledISO).getTime() < Date.now()) { toast.error("请选择未来的时间"); return; }
    if (takenSlots.includes(form.slot)) { toast.error("该时间段已被预约，请换一个"); return; }
    setSubmitting(true);
    const { error, data } = await supabase.from("tutor_trial_bookings").insert({
      user_id: user.id,
      teacher: form.teacher,
      preferred_time: `${format(form.date, "yyyy-MM-dd")} ${form.slot}`,
      scheduled_at: scheduledISO,
      contact: form.contact,
      note: form.note || null,
    }).select("teacher, created_at, scheduled_at").maybeSingle();
    setSubmitting(false);
    if (error) {
      if (error.code === "23505") {
        // could be user unique or slot unique
        toast.error("预约冲突：你已预约过或该时间段刚被抢占，请换一个时间");
      }
      else toast.error("预约失败，请稍后重试");
      return;
    }
    setExistingBooking(data ?? { teacher: form.teacher, created_at: new Date().toISOString(), scheduled_at: scheduledISO });
    setDialogOpen(false);
    toast.success("已预约成功！老师将在 24 小时内与你联系");
  }

  function onSubscribe(planId: Plan["id"]) {
    if (!user) {
      toast.error("请先登录再订阅课程");
      return;
    }
    if (planId === "tutor_single_lesson") {
      setQty(1);
      setQtyOpen(true);
      return;
    }
    void openCheckout({ priceId: planId, userId: user.id, email: user.email });
  }

  function confirmSingleLesson() {
    if (!user) return;
    const n = Math.max(1, Math.min(20, Math.floor(qty || 1)));
    setQtyOpen(false);
    void openCheckout({ priceId: "tutor_single_lesson", userId: user.id, email: user.email, quantity: n });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <GraduationCap className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">五分大神带你飞</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          直接跟着拿过 AP 微观经济 5 分的学长学姐上一对一直播辅导课，把不会的知识点、FRQ 逐一击破。
        </p>
      </header>

      <section aria-label="免费试课" className="mx-auto mt-10 max-w-3xl">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Gift className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">每个账号赠送 1 节免费试课（60 分钟）</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {existingBooking
                    ? `你已预约了 ${existingBooking.teacher} 老师的免费试课，老师会通过你填写的联系方式与你排课。`
                    : "选择 Steve 或 Venus 老师，留下联系方式，24 小时内我们会与你确认上课时间。"}
                </p>
              </div>
            </div>
            <Button disabled={checking || !!existingBooking} onClick={() => openBookingFor(form.teacher || "Steve")}>
              {existingBooking ? "已使用" : checking ? "加载中…" : "立即预约免费试课"}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-label="教师团队" className="mx-auto mt-10 max-w-4xl">
        <h2 className="text-xl font-semibold">教师团队</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {TEACHERS.map((t) => (
            <Card key={t.name} className="overflow-hidden">
              <CardHeader className="flex flex-col items-center pb-3 pt-6 text-center">
                {t.avatar ? (
                  <img
                    src={t.avatar}
                    alt={`${t.name} 头像`}
                    className="h-20 w-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                    {t.name[0]}
                  </div>
                )}
                <div className="mt-4 space-y-1">
                  <CardTitle className="text-xl">{t.name}</CardTitle>
                  <div className="text-sm text-muted-foreground">{t.title}</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pb-6 text-center">
                <div className="rounded-xl bg-primary/5 px-4 py-3">
                  <p className="text-sm font-medium leading-relaxed text-primary/90">
                    “{t.motto}”
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {t.desc}
                </p>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={checking || !!existingBooking}
                  onClick={() => openBookingFor(t.name)}
                >
                  {existingBooking
                    ? (existingBooking.teacher === t.name ? "已预约本老师" : "已使用免费试课")
                    : `预约 ${t.name} 老师试课`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Shared booking dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>预约免费 1 小时试课 · {form.teacher} 老师</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择老师</Label>
              <Select value={form.teacher} onValueChange={(v) => setForm((f) => ({ ...f, teacher: v, slot: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Steve">Steve</SelectItem>
                  <SelectItem value="Venus">Venus</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>上课日期</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !form.date && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.date ? format(form.date, "yyyy-MM-dd") : "选择日期"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.date}
                      onSelect={(d) => setForm((f) => ({ ...f, date: d ?? undefined, slot: "" }))}
                      disabled={(d) => {
                        const today = new Date(); today.setHours(0,0,0,0);
                        const max = new Date(); max.setDate(max.getDate() + 30);
                        return d < today || d > max;
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>时间段 {loadingSlots && <span className="text-xs text-muted-foreground">校验中…</span>}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {TIME_SLOTS.map((s) => {
                    const taken = takenSlots.includes(s);
                    const past = form.date
                      ? new Date(toSlotISO(form.date, s)).getTime() < Date.now()
                      : false;
                    const disabled = !form.date || taken || past;
                    return (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={form.slot === s ? "default" : "outline"}
                        disabled={disabled}
                        onClick={() => setForm((f) => ({ ...f, slot: s }))}
                      >
                        {s}{taken ? "×" : ""}
                      </Button>
                    );
                  })}
                </div>
                {form.date && takenSlots.length > 0 && (
                  <p className="text-xs text-muted-foreground">带 × 的时间段已被约</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>联系方式</Label>
              <Input placeholder="微信 / 邮箱 / 手机号" value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>想重点讲解的内容（选填）</Label>
              <Textarea rows={3} value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={submitTrial} disabled={submitting}>{submitting ? "提交中…" : "确认预约"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <Card key={plan.id} className={plan.highlight ? "border-primary/50 shadow-md" : undefined}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                {plan.badge && (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    {plan.badge}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-3xl font-bold">{plan.price}</span>
                <span className="ml-1 text-sm text-muted-foreground">{plan.unit}</span>
              </div>
              <p className="text-sm text-muted-foreground">{plan.desc}</p>
              <ul className="space-y-1.5 text-sm">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                disabled={loading}
                variant={plan.highlight ? "default" : "outline"}
                onClick={() => onSubscribe(plan.id)}
              >
                立即订阅
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-label="课程说明" className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <Users className="h-5 w-5 text-primary" />
          <div className="mt-2 font-semibold">全部 5 分学长学姐</div>
          <p className="mt-1 text-sm text-muted-foreground">辅导老师均为 AP 微观经济官方 5 分获得者，熟悉考纲与得分点。</p>
        </div>
        <div className="rounded-xl border p-4">
          <Video className="h-5 w-5 text-primary" />
          <div className="mt-2 font-semibold">1v1 视频直播</div>
          <p className="mt-1 text-sm text-muted-foreground">课前预约时间，腾讯会议 / Zoom 直播上课，录屏回看不限次。</p>
        </div>
        <div className="rounded-xl border p-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <div className="mt-2 font-semibold">配合平台使用</div>
          <p className="mt-1 text-sm text-muted-foreground">老师会基于你在 EasyEcon 的错题与模考数据针对性讲解。</p>
        </div>
      </section>

      <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
        订阅成功后我们会在 24 小时内通过邮件联系你安排排课。付款由 Paddle 安全处理，购买即表示同意
        <Link to="/legal/terms" className="text-primary underline">服务条款</Link>、
        <Link to="/legal/refunds" className="text-primary underline">14 天退款政策</Link>与
        <Link to="/legal/privacy" className="text-primary underline">隐私声明</Link>。
      </p>
    </main>
  );
}