import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, ListChecks, Library, GraduationCap, LogOut, Bookmark, Shield, MessageSquarePlus, UserRound, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { isAdminEmail } from "@/lib/admin-emails";
import { FeedbackWidget } from "@/components/FeedbackWidget";

const practiceItems = [
  { title: "刷题", url: "/", icon: BookOpen, exact: true },
  { title: "错题本", url: "/wrong", icon: Bookmark },
  { title: "模拟考试", url: "/mock", icon: ListChecks },
  { title: "五分大神带你飞", url: "/tutor", icon: Sparkles },
];

const refItems = [{ title: "术语表", url: "/terms", icon: Library }];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user, signOut } = useAuth();
  const showAdmin = isAdminEmail(user?.email);
  const [fbOpen, setFbOpen] = useState(false);
  const showFeedback = !path.startsWith("/admin");

  const isActive = (url: string, exact?: boolean) => (exact ? path === url : path === url || path.startsWith(url + "/"));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold">APMicro</div>
              <div className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                练习平台
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>练习</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {practiceItems.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild isActive={isActive(it.url, it.exact)}>
                    <Link to={it.url} className="flex items-center gap-2">
                      <it.icon className="h-4 w-4" />
                      {!collapsed && <span>{it.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {showFeedback && (
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setFbOpen(true)} className="flex items-center gap-2">
                    <MessageSquarePlus className="h-4 w-4" />
                    {!collapsed && <span>反馈</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>参考</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {refItems.map((it) => (
                <SidebarMenuItem key={it.url}>
                  <SidebarMenuButton asChild isActive={isActive(it.url)}>
                    <Link to={it.url} className="flex items-center gap-2">
                      <it.icon className="h-4 w-4" />
                      {!collapsed && <span>{it.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {user && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/profile")}>
                    <Link to="/profile" className="flex items-center gap-2">
                      <UserRound className="h-4 w-4" />
                      {!collapsed && <span>个人资料</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {showAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")}>
                    <Link to="/admin" className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      {!collapsed && <span>管理后台</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        {user ? (
          <div className="space-y-2">
            {!collapsed && (
              <div className="text-xs text-muted-foreground truncate" title={user.email ?? ""}>
                {user.email}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => signOut()}
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span className="ml-2">退出登录</span>}
            </Button>
          </div>
        ) : (
          <Button asChild size="sm" className="w-full">
            <Link to="/auth">登录 / 注册</Link>
          </Button>
        )}
      </SidebarFooter>
      {showFeedback && <FeedbackWidget open={fbOpen} onOpenChange={setFbOpen} />}
    </Sidebar>
  );
}