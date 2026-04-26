import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyToken } from "@/lib/admin-token.server";

type Item = {
  knowledge_point_slug: string;
  type: "basic" | "application" | "pitfall";
  difficulty?: number;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e?: string | null;
  correct_answer: "A" | "B" | "C" | "D" | "E";
  explanation: string;
  pitfall_note?: string | null;
  term_tags?: string[];
  status?: "draft" | "published";
};

export const Route = createFileRoute("/api/admin/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyToken(request.headers.get("x-admin-token"))) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        const { items } = (await request.json()) as { items: Item[] };
        if (!Array.isArray(items) || items.length === 0) {
          return new Response(JSON.stringify({ error: "empty items" }), { status: 400 });
        }
        const { data: kps } = await supabaseAdmin.from("knowledge_points").select("id,slug");
        const slugMap = new Map((kps ?? []).map((k) => [k.slug, k.id]));

        const rows = items.map((it) => {
          const kpId = slugMap.get(it.knowledge_point_slug);
          if (!kpId) throw new Error(`未知 knowledge_point_slug: ${it.knowledge_point_slug}`);
          return {
            knowledge_point_id: kpId,
            type: it.type,
            difficulty: it.difficulty ?? 2,
            stem: it.stem,
            option_a: it.option_a,
            option_b: it.option_b,
            option_c: it.option_c,
            option_d: it.option_d,
            option_e: it.option_e ?? null,
            correct_answer: it.correct_answer,
            explanation: it.explanation,
            pitfall_note: it.pitfall_note ?? null,
            term_tags: it.term_tags ?? [],
            status: it.status ?? "draft",
          };
        });

        try {
          const { data, error } = await supabaseAdmin.from("questions").insert(rows).select("id");
          if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
          return Response.json({ inserted: data?.length ?? 0 });
        } catch (e) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "import failed" }), { status: 400 });
        }
      },
    },
  },
});