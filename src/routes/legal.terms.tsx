import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({ meta: [{ title: "服务条款 · EasyEcon" }, { name: "description", content: "EasyEcon 服务、AI 功能和会员订阅使用条款。" }] }),
  component: TermsOfService,
});

function TermsOfService() {
  return <LegalPage title="服务条款" updated="2026 年 6 月 13 日">
    <LegalSection title="1. 合同主体与接受"><p>EasyEcon 由 Ziyan Chen（陈籽言，“我们”）提供，你与 Ziyan Chen 订立本服务合同。注册、购买或继续使用本服务，即表示你同意本条款。你须达到所在地法定年龄，或已获得监护人同意。</p></LegalSection>
    <LegalSection title="2. 服务与许可"><p>EasyEcon 提供 AP 经济学练习、模考与 AI 辅助讲解/评分。我们授予你在所选方案有效期内有限、非独占、不可转让的个人使用权。服务可能调整、中断或出错，我们不保证持续、无误或完全符合特定目的。</p></LegalSection>
    <LegalSection title="3. 账号责任"><p>你应提供准确信息、保护登录凭据，并对账号内活动负责。不得共享、转售账号或规避配额及功能限制。</p></LegalSection>
    <LegalSection title="4. 订阅、付款与退款"><p>订单由在线经销商 Paddle.com 处理。Paddle.com 是所有订单的 Merchant of Record，负责付款相关客服与退款。计费、税费、续费、取消及退款机制适用 <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noreferrer">Paddle Buyer Terms</a>。月付与年付切换即时生效并按比例结算；取消后权益保留至已付周期结束；付款失败时 Pro 权益立即暂停。</p></LegalSection>
    <LegalSection title="5. AI 使用规则"><p>你对提示词、上传内容及输出用途负责，并保证有权提供输入内容。禁止生成或传播违法、欺诈、仇恨、侵权、恶意软件、非自愿深度伪造内容，禁止越狱、抓取、探测或干扰安全措施。AI 输出可能不准确，不构成专业、法律、财务或升学建议；提交前应自行核实。</p><p>我们可过滤或拒绝输出、移除内容、处理权利人投诉，并对重复侵权或严重违规账号暂停或终止服务。</p></LegalSection>
    <LegalSection title="6. 知识产权"><p>服务软件、题库编排、文档与品牌归我们或许可方所有。你保留输入内容的权利；在法律允许范围内，你可使用生成输出。你授予我们仅为提供、保护和改进服务而处理输入内容的有限许可。侵权投诉可通过应用内反馈提交。</p></LegalSection>
    <LegalSection title="7. 禁止行为与终止"><p>不得违法使用、欺诈或发送垃圾信息、侵犯知识产权、传播恶意代码、反向工程、批量抓取、转售服务或干扰系统。重大违约、欠费、安全或欺诈风险及反复严重违规时，我们可暂停或终止访问。</p></LegalSection>
    <LegalSection title="8. 责任限制"><p>在法律允许的最大范围内，我们不对间接、附带或后果性损失负责；总责任不超过你在争议发生前 12 个月支付的服务费用。法律不得排除的欺诈、人身伤害等责任不受此限制。</p></LegalSection>
  </LegalPage>;
}