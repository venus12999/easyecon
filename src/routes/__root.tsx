import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { TopNav } from "@/components/TopNav";
import { FeedbackButton } from "@/components/FeedbackButton";
import { FloatingMascot } from "@/components/FloatingMascot";
import { LOGO_URL } from "@/lib/brand";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">页面不存在</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          这个地址没有对应的页面，可能已被移动或删除。
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "EasyEcon" },
      { name: "description", content: "面向中国学生的 AP 微观经济刷题与模考：中英术语对照、官方风格解析与 AI 答疑。" },
      { name: "author", content: "EasyEcon" },
      { property: "og:title", content: "EasyEcon · AP 微观经济刷题" },
      { property: "og:description", content: "面向中国学生的 AP 微观经济刷题与模考：中英术语对照、官方风格解析与 AI 答疑。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "EasyEcon · AP 微观经济刷题" },
      { name: "twitter:description", content: "面向中国学生的 AP 微观经济刷题与模考。" },
      { property: "og:image", content: "https://easyecon.lovable.app/logo.png" },
      { name: "twitter:image", content: "https://easyecon.lovable.app/logo.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: LOGO_URL,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isAuthRoute = path === "/auth" || path === "/reset-password";
  const isMockExam = path.startsWith("/mock/");
  return (
    <AuthProvider>
      <div className="app-gradient-bg flex min-h-screen w-full flex-col">
        <TopNav />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
        {!isAuthRoute && (
          <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 px-4 py-4 text-xs text-foreground/60">
            <Link to="/pricing">定价</Link>
            <Link to="/legal/terms">服务条款</Link>
            <Link to="/legal/refunds">退款政策</Link>
            <Link to="/legal/privacy">隐私声明</Link>
          </footer>
        )}
      </div>
      {!isMockExam && !path.startsWith("/admin") && <FeedbackButton />}
      {!isMockExam && !isAuthRoute && <FloatingMascot />}
      <Toaster richColors position="top-center" />
    </AuthProvider>
  );
}
