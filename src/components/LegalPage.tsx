import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-2"><h2 className="text-lg font-semibold">{title}</h2><div className="space-y-2 text-sm leading-7 text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline">{children}</div></section>;
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return <main className="mx-auto max-w-3xl px-5 py-12"><div className="mb-10 border-b pb-6"><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">最后更新：{updated}</p></div><div className="space-y-8">{children}</div><nav className="mt-12 flex flex-wrap gap-4 border-t pt-6 text-sm"><Link to="/pricing" className="text-primary">定价</Link><Link to="/legal/terms" className="text-primary">服务条款</Link><Link to="/legal/refunds" className="text-primary">退款政策</Link><Link to="/legal/privacy" className="text-primary">隐私声明</Link><Link to="/">返回首页</Link></nav></main>;
}