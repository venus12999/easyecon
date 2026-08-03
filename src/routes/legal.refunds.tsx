import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const Route = createFileRoute("/legal/refunds")({
  head: () => ({ meta: [{ title: "退款政策 · EasyEcon" }, { name: "description", content: "EasyEcon 会员订阅 14 天退款政策和申请方式。" }] }),
  component: RefundPolicy,
});

function RefundPolicy() {
  return <LegalPage title="退款政策" updated="2026 年 6 月 13 日">
    <LegalSection title="卖方"><p>EasyEcon 由 Ziyan Chen（陈籽言）提供。</p></LegalSection>
    <LegalSection title="14 天退款期"><p>如果你对购买不满意，可在订单日期起 14 天内申请全额退款。</p></LegalSection>
    <LegalSection title="如何申请"><p>请通过应用内反馈联系我们，并提供订单号与付款截图。核实后我们会按你的原付款渠道（微信 / 支付宝）退回款项，一般在 7 个工作日内到账。</p></LegalSection>
    <LegalSection title="处理说明"><p>退款到账时间取决于原付款方式与金融机构。退款获批后，对应会员权益可能被终止。法定消费者权利不受本政策影响。</p></LegalSection>
  </LegalPage>;
}