import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, GraduationCap, Sparkles, Users, Video } from "lucide-react";
import { usePaddleCheckout } from "@/hooks/use-paddle-checkout";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

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
  id: "tutor_single_lesson" | "tutor_pack_5" | "tutor_pack_10";
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
    id: "tutor_single_lesson",
    name: "单次体验课",
    price: "¥299",
    unit: "/ 1 节 · 60 分钟",
    desc: "先试一节，快速评估当前水平与备考差距。",
    perks: ["1v1 视频直播", "课后微信答疑 24h", "个性化学习建议"],
  },
  {
    id: "tutor_pack_5",
    name: "5 节冲刺包",
    price: "¥1399",
    unit: "/ 5 节 · 60 分钟/节",
    desc: "覆盖薄弱 Unit + FRQ 精讲，性价比首选。",
    perks: ["1v1 视频直播 5 节", "错题精讲 + FRQ 批改", "模考卷讲评 1 次"],
    highlight: true,
    badge: "推荐",
  },
  {
    id: "tutor_pack_10",
    name: "10 节满分包",
    price: "¥2599",
    unit: "/ 10 节 · 60 分钟/节",
    desc: "系统覆盖全部 6 个 Unit + 3 套整卷模考。",
    perks: ["1v1 视频直播 10 节", "全套 Unit 精讲", "3 套模考全卷讲评"],
  },
];

function TutorPage() {
  const { user } = useAuth();
  const { openCheckout, loading } = usePaddleCheckout();

  function onSubscribe(planId: Plan["id"]) {
    if (!user) {
      toast.error("请先登录再订阅课程");
      return;
    }
    void openCheckout({ priceId: planId, userId: user.id, email: user.email });
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

      <section className="mx-auto mt-10 grid gap-4 sm:grid-cols-3">
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