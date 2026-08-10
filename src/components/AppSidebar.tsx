import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, Shield, MessageSquarePlus, UserRound, CalendarCheck, Receipt } from "lucide-react";
import { useState } from "react";
import logoAsset from "@/assets/logo.png.asset.json";
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
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { isAdminEmail } from "@/lib/admin-emails";
import { FeedbackWidget } from "@/components/FeedbackWidget";

export function AppSidebar() {
  const collapsed = false;
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user, signOut } = useAuth();
  const showAdmin = isAdminEmail(user?.email);
  const [fbOpen, setFbOpen] = useState(false);
  const showFeedback = !path.startsWith("/admin");

  const isActive = (url: string, exact?: boolean) => (exact ? path === url : path === url || path.startsWith(url + "/"));

  return (
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={logoAsset.url}
            alt="EasyEcon"
            className="h-8 w-8 rounded-lg object-cover shrink-0 bg-primary/10"
          />
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold">EasyEcon</div>
              <div className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                AP 经济练习
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>我的</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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
              {user && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/tutor-bookings")}>
                    <Link to="/tutor-bookings" className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4" />
                      {!collapsed && <span>我的试课预约</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {user && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/orders")}>
                    <Link to="/orders" className="flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      {!collapsed && <span>我的订单</span>}
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
              {showAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin-tutor")}>
                    <Link to="/admin-tutor" className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4" />
                      {!collapsed && <span>试课预约管理</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {showFeedback && (
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setFbOpen(true)} className="flex items-center gap-2">
                    <MessageSquarePlus className="h-4 w-4" />
                    <span>反馈</span>
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