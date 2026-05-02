import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyToken } from "@/lib/admin-token.server";

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!verifyToken(request.headers.get("x-admin-token"))) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        const url = new URL(request.url);
        const userId = url.searchParams.get("user_id");

        if (!userId) {
          // 列表：所有 profiles + 聚合答题数与正确率 + 模考次数
          const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("user_id,email,display_name,created_at")
            .order("created_at", { ascending: false });
          const { data: attempts } = await supabaseAdmin
            .from("answer_attempts")
            .select("user_id,is_correct,created_at");
          const { data: mocks } = await supabaseAdmin
            .from("mock_attempts")
            .select("user_id");
          const stat: Record<string, { total: number; correct: number; last: string | null; mocks: number }> = {};
          (attempts ?? []).forEach((a) => {
            const s = (stat[a.user_id] ??= { total: 0, correct: 0, last: null, mocks: 0 });
            s.total += 1;
            if (a.is_correct) s.correct += 1;
            if (!s.last || a.created_at > s.last) s.last = a.created_at;
          });
          (mocks ?? []).forEach((m) => {
            const s = (stat[m.user_id] ??= { total: 0, correct: 0, last: null, mocks: 0 });
            s.mocks += 1;
          });
          const users = (profiles ?? []).map((p) => ({ ...p, ...(stat[p.user_id] ?? { total: 0, correct: 0, last: null, mocks: 0 }) }));
          return Response.json({ users });
        }

        // 详情
        const [{ data: profile }, { data: attempts }, { data: mocks }, { data: wrongs }] = await Promise.all([
          supabaseAdmin.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
          supabaseAdmin
            .from("answer_attempts")
            .select("id,question_id,knowledge_point_id,picked_answer,is_correct,mode,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(500),
          supabaseAdmin
            .from("mock_attempts")
            .select("id,total,correct,duration_seconds,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false }),
          supabaseAdmin
            .from("wrong_questions")
            .select("question_id,added_at")
            .eq("user_id", userId),
        ]);
        const qIds = Array.from(
          new Set([...(attempts ?? []).map((a) => a.question_id), ...(wrongs ?? []).map((w) => w.question_id)]),
        );
        let qMap: Record<string, { stem: string; correct_answer: string }> = {};
        if (qIds.length) {
          const { data: qs } = await supabaseAdmin
            .from("questions")
            .select("id,stem,correct_answer")
            .in("id", qIds);
          (qs ?? []).forEach((q) => (qMap[q.id] = { stem: q.stem, correct_answer: q.correct_answer }));
        }
        return Response.json({ profile, attempts, mocks, wrongs, questions: qMap });
      },
    },
  },
});