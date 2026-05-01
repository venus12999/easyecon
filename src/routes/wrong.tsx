import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getWrong, removeWrong } from "@/lib/storage";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/wrong")({
  head: () => ({ meta: [{ title: "错题本 · AP 微观经济" }] }),
  component: WrongBook,
});

type Q = {
  id: string;
  stem: string;
  knowledge_point_id: string;
  knowledge_points: { name_zh: string; slug: string } | null;
};

function WrongBook() {
  const [items, setItems] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const ids = getWrong();
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data: qs, error: qErr } = await supabase
      .from("questions")
      .select("id,stem,knowledge_point_id")
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
      knowledge_point_id: q.knowledge_point_id,
      knowledge_points: kpMap[q.knowledge_point_id] ?? null,
    }));
    setItems(merged);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
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
          <div className="space-y-3">
            {items.map((q) => (
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
                      onClick={() => {
                        removeWrong(q.id);
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
        )}
      </main>
    </div>
  );
}