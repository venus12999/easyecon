import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({ meta: [{ title: "隐私声明 · EasyEcon" }, { name: "description", content: "EasyEcon 如何收集、使用、共享和保护个人数据。" }] }),
  component: PrivacyNotice,
});

function PrivacyNotice() {
  return <LegalPage title="隐私声明" updated="2026 年 6 月 13 日">
    <LegalSection title="1. 数据控制者"><p>Ziyan Chen（陈籽言）是 EasyEcon 账号与学习数据的数据控制者。</p></LegalSection>
    <LegalSection title="2. 我们收集的数据"><p>我们处理邮箱、昵称和登录凭据；答题、错题、模考、AI 提问、上传答案及使用记录；支持消息；以及保障安全所需的 IP、设备和基础日志。付款资料由 Paddle 直接处理，我们不会存储完整银行卡信息。</p></LegalSection>
    <LegalSection title="3. 用途与法律基础"><p>我们基于履行合同处理账号、学习记录和会员权益；基于合法利益防欺诈、保障安全、诊断错误并改进产品；基于法律义务保存必要交易或争议记录；需要时基于同意发送非必要通信。</p></LegalSection>
    <LegalSection title="4. 数据共享"><p>数据可与托管、认证、AI、存储和支持服务商共享；与 Merchant of Record Paddle 共享销售、订阅管理、付款、税务和开票所需信息；也可在法律要求下与专业顾问或主管机关共享。我们不出售个人数据。</p></LegalSection>
    <LegalSection title="5. 保存、安全与跨境"><p>账号有效期间保存服务数据，之后仅在解决争议、履行法律义务所需期限内保留，再删除或匿名化。我们采用访问控制、传输加密和最小权限措施。服务商可能在其他国家处理数据，并使用适用的合同条款或充分性机制保护跨境传输。</p></LegalSection>
    <LegalSection title="6. 你的权利"><p>依适用法律，你可请求访问、更正、删除、限制或导出数据，反对特定处理，撤回同意并向监管机构投诉。可通过应用内反馈联系我们；我们通常会在一个月内回复。</p></LegalSection>
    <LegalSection title="7. Cookie"><p>我们使用维持登录、安全和核心功能所必需的本地存储或 Cookie。若未来启用非必要分析或营销 Cookie，我们会提供相应选择。</p></LegalSection>
  </LegalPage>;
}