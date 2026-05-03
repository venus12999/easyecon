import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getWrong, removeWrong } from "@/lib/storage";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/wrong")({
  head: () => ({ meta: [{ title: "错题本 · AP 微观经济" }] }),
  component: WrongBook,
});

type Q = {
  id: string;
  stem: string;
  type: "basic" | "application" | "pitfall";
  knowledge_point_id: string;
  knowledge_points: { name_zh: string; slug: string } | null;
};

function WrongBook() {
  const { user } = useAuth();
  const [items, setItems] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    let ids: string[] = [];
    if (user) {
      const { data } = await supabase
        .from("wrong_questions")
        .select("question_id")
        .eq("user_id", user.id);
      ids = (data ?? []).map((r) => r.question_id);
    } else {
      ids = getWrong();
    }
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data: qs, error: qErr } = await supabase
      .from("questions")
      .select("id,stem,type,knowledge_point_id")
      .in("id", ids);
    if (qErr) {
      console.error("[wrong] questions query failed", qErr);
      setItems([]);
      setLoading(false);
      return;
    }
    const kpIds = Array.from(new Set((qs ?? []).map((q) => q.knowledge_point_id)));
    const kpMap: Record<string, { name_zh: string; slug: string }> = {};
    if (kpIds.length > 0) {
      const { data: kps } = await supabase
        .from("knowledge_points")
        .select("id,name_zh,slug")
        .in("id", kpIds);
      (kps ?? []).forEach((k) => {
        kpMap[k.id] = { name_zh: k.name_zh, slug: k.slug };
      });
    }
    const merged: Q[] = (qs ?? []).map((q) => ({
      id: q.id,
      stem: q.stem,
      type: q.type as Q["type"],
      knowledge_point_id: q.knowledge_point_id,
      knowledge_points: kpMap[q.knowledge_point_id] ?? null,
    }));
    setItems(merged);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [user]);

  return (
    <div className="min-h-screen bg-background">
      
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">错题本</h1>
        <p className="text-muted-foreground text-sm mb-6">数据保存在你的浏览器本地</p>
        {loading ? (
          <p className="text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              暂无错题。继续刷题吧 →
              <div className="mt-4">
                <Button asChild><Link to="/">去刷题</Link></Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {(["basic", "application", "pitfall"] as const).map((t) => {
              const group = items.filter((q) => q.type === t);
              if (group.length === 0) return null;
              const label = t === "basic" ? "基础题（概念）" : t === "application" ? "应用题（情境）" : "易错题（常见坑）";
              return (
                <div key={t}>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-2">{label} · {group.length}</h2>
                  <div className="space-y-3">
                    {group.map((q) => (
              <Card key={q.id}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-primary mb-1">{q.knowledge_points?.name_zh}</div>
                    <p className="text-sm line-clamp-2">{q.stem}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {q.knowledge_points?.slug && (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/practice/$slug" params={{ slug: q.knowledge_points.slug }} search={{}}>
                          重做
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        removeWrong(q.id);
                        if (user) {
                          await supabase
                            .from("wrong_questions")
                            .delete()
                            .eq("user_id", user.id)
                            .eq("question_id", q.id);
                        }
                        load();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}