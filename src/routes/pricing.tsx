import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "EasyEcon Pro 定价｜月付 ¥19，季付 ¥55，年付 ¥199" },
      { name: "description", content: "查看 EasyEcon 免费版与 Pro 会员功能。Pro 包含更多 AI 讲解、FRQ 智能评分及不限次刷题与模考。" },
      { property: "og:title", content: "EasyEcon Pro 定价" },
      { property: "og:description", content: "月付 ¥19、季付 ¥55 或年付 ¥199，解锁 AI 讲解、FRQ 评分和不限次练习。" },
    ],
  }),
  component: PricingPage,
});

const features = [
  { name: "AI 题目讲解", free: "基础额度", pro: "每天 30 次" },
  { name: "FRQ 智能评分", free: "基础额度", pro: "每天 10 次" },
  { name: "刷题与模考", free: "有限体验", pro: "不限次数" },
];

function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Crown className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">选择适合你的学习方案</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">先免费体验，准备好后升级 Pro，获得更充足的 AI 学习支持。</p>
      </header>

      <section aria-label="Pro 会员价格" className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-lg">Pro 月度会员</CardTitle></CardHeader>
          <CardContent>
            <p><span className="text-4xl font-bold">¥19</span><span className="text-muted-foreground"> / 月</span></p>
            <p className="mt-3 text-sm text-muted-foreground">按月续费，灵活开始或取消。</p>
          </CardContent>
        </Card>
        <Card className="border-primary/40">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-lg">Pro 季度会员</CardTitle>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">推荐</span>
            </div>
          </CardHeader>
          <CardContent>
            <p><span className="text-4xl font-bold">¥55</span><span className="text-muted-foreground"> / 季</span></p>
            <p className="mt-3 text-sm text-muted-foreground">相比月付每季节省 ¥2，考试冲刺首选。</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-lg">Pro 年度会员</CardTitle>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">最划算</span>
            </div>
          </CardHeader>
          <CardContent>
            <p><span className="text-4xl font-bold">¥199</span><span className="text-muted-foreground"> / 年</span></p>
            <p className="mt-3 flex items-center gap-1 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />相比月付每年节省 ¥29。</p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="comparison-title" className="mx-auto mt-10 max-w-3xl">
        <h2 id="comparison-title" className="mb-4 text-xl font-semibold">功能对比</h2>
        <div className="overflow-hidden rounded-xl border">
          <div className="grid grid-cols-3 bg-muted/50 px-4 py-3 text-sm font-semibold"><span>功能</span><span>免费版</span><span>Pro</span></div>
          {features.map((feature) => (
            <div key={feature.name} className="grid grid-cols-3 items-center border-t px-4 py-4 text-sm">
              <span className="font-medium">{feature.name}</span>
              <span className="text-muted-foreground">{feature.free}</span>
              <span className="flex items-center gap-2 font-medium"><Check className="h-4 w-4 text-primary" aria-hidden="true" />{feature.pro}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-3xl text-center">
        <Button asChild size="lg"><Link to="/auth">登录或注册后升级 Pro</Link></Button>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">付款由 Paddle 安全处理。购买即表示同意 <Link to="/legal/terms" className="text-primary underline">服务条款</Link>、<Link to="/legal/refunds" className="text-primary underline">14 天退款政策</Link>和 <Link to="/legal/privacy" className="text-primary underline">隐私声明</Link>。</p>
      </section>
    </main>
  );
}