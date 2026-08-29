import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "术语速查 · AP 微观经济" },
      { name: "description", content: "AP 微观经济学英文术语中英对照、定义与易混词查询。" },
    ],
  }),
  component: TermsPage,
});

type Term = {
  id: string;
  term_en: string;
  term_zh: string;
  definition: string;
  confusable_with: string[] | null;
  unit: number | null;
};

function TermsPage() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("terms")
      .select("*")
      .order("term_en")
      .then(({ data }) => setTerms((data ?? []) as Term[]));
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return terms;
    return terms.filter(
      (t) =>
        t.term_en.toLowerCase().includes(k) ||
        t.term_zh.includes(k) ||
        t.definition.toLowerCase().includes(k),
    );
  }, [terms, q]);

  const groups = useMemo(() => {
    const map: Record<string, Term[]> = {};
    filtered.forEach((t) => {
      const letter = t.term_en[0]?.toUpperCase() ?? "#";
      (map[letter] ||= []).push(t);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="min-h-screen">
      
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mb-1">术语速查</h1>
        <p className="text-muted-foreground text-sm mb-6">英文术语 · 中文翻译 · 定义 · 易混词</p>
        <Input
          placeholder="搜索英文 / 中文 / 定义关键词…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-6 max-w-md"
        />
        {groups.map(([letter, items]) => (
          <section key={letter} className="mb-8">
            <h2 className="text-sm font-semibold text-primary mb-3">{letter}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((t) => (
                <Card key={t.id}>
                  <CardContent className="p-4 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{t.term_en}</span>
                      <span className="text-sm text-primary">{t.term_zh}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t.definition}</p>
                    {t.confusable_with && t.confusable_with.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {t.confusable_with.map((c) => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground border border-warning/30">
                            易混：{c}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="text-center text-muted-foreground py-12">无匹配结果</p>
        )}
      </main>
    </div>
  );
}