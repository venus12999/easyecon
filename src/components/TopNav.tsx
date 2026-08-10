import { Link, useRouterState } from "@tanstack/react-router";
import { UserRound, Receipt, CalendarCheck, Shield, LogOut, ChevronDown } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { isAdminEmail } from "@/lib/admin-emails";

export function TopNav() {
  const { user, signOut } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const showAdmin = isAdminEmail(user?.email);
  const label = user?.email?.split("@")[0] ?? "";

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
      <div className="glass mx-auto flex h-12 max-w-6xl items-center gap-3 rounded-2xl px-3">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <img src={logoAsset.url} alt="EasyEcon" className="h-7 w-7 shrink-0 rounded-lg object-cover" />
          <span className="truncate text-sm font-bold">EasyEcon</span>
        </Link>
        <div className="flex-1" />
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-[45vw] gap-1">
                <UserRound className="h-4 w-4 shrink-0" />
                <span className="truncate text-xs sm:text-sm">{label}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link to="/profile"><UserRound className="mr-2 h-4 w-4" />个人资料</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/orders"><Receipt className="mr-2 h-4 w-4" />我的订单</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/tutor-bookings"><CalendarCheck className="mr-2 h-4 w-4" />我的试课预约</Link>
              </DropdownMenuItem>
              {showAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/admin"><Shield className="mr-2 h-4 w-4" />管理后台</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/admin-tutor"><CalendarCheck className="mr-2 h-4 w-4" />试课预约管理</Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          path !== "/auth" && (
            <Button asChild size="sm">
              <Link to="/auth">登录 / 注册</Link>
            </Button>
          )
        )}
      </div>
    </header>
  );
}
