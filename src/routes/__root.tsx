import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import logoAsset from "@/assets/logo.png.asset.json";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingMascot } from "@/components/FloatingMascot";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
      { name: "description", content: "AP Study Buddy is an AI-powered practice app for Chinese AP Economics students." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "EasyEcon" },
      { property: "og:description", content: "AP Study Buddy is an AI-powered practice app for Chinese AP Economics students." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "EasyEcon" },
      { name: "twitter:description", content: "AP Study Buddy is an AI-powered practice app for Chinese AP Economics students." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/582cb513-4b5d-4668-9f43-c48a925e9a8a/id-preview-26e84ba8--f5c36f87-53cf-4e52-b0f3-f0fd7949b5f6.lovable.app-1776955658361.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/582cb513-4b5d-4668-9f43-c48a925e9a8a/id-preview-26e84ba8--f5c36f87-53cf-4e52-b0f3-f0fd7949b5f6.lovable.app-1776955658361.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: logoAsset.url,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
  if (isAuthRoute) {
    return (
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-center" />
      </AuthProvider>
    );
  }
  return (
    <AuthProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
             <PaymentTestModeBanner />
            <header className="h-12 flex items-center border-b bg-card/40 backdrop-blur sticky top-0 z-30">
              <SidebarTrigger className="ml-2" />
            </header>
            <main className="flex-1 min-w-0">
              <Outlet />
            </main>
            <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t px-4 py-4 text-xs text-muted-foreground">
              <Link to="/pricing">定价</Link>
              <Link to="/legal/terms">服务条款</Link>
              <Link to="/legal/refunds">退款政策</Link>
              <Link to="/legal/privacy">隐私声明</Link>
            </footer>
          </div>
        </div>
        <FloatingMascot />
        <Toaster richColors position="top-center" />
      </SidebarProvider>
    </AuthProvider>
  );
}
