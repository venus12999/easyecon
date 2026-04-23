import { Link } from "@tanstack/react-router";
import { BookOpen, GraduationCap, Library, ListChecks } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span>AP 经济刷题</span>
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            AP Microeconomics
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            className="px-3 py-1.5 rounded-md hover:bg-accent flex items-center gap-1.5"
            activeProps={{ className: "bg-accent text-accent-foreground" }}
            activeOptions={{ exact: true }}
          >
            <BookOpen className="h-4 w-4" /> 知识点
          </Link>
          <Link
            to="/mock"
            className="px-3 py-1.5 rounded-md hover:bg-accent flex items-center gap-1.5"
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            <ListChecks className="h-4 w-4" /> 模考
          </Link>
          <Link
            to="/wrong"
            className="px-3 py-1.5 rounded-md hover:bg-accent flex items-center gap-1.5"
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            错题本
          </Link>
          <Link
            to="/terms"
            className="px-3 py-1.5 rounded-md hover:bg-accent flex items-center gap-1.5"
            activeProps={{ className: "bg-accent text-accent-foreground" }}
          >
            <Library className="h-4 w-4" /> 术语
          </Link>
        </nav>
      </div>
    </header>
  );
}