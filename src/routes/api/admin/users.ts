import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAdminRequest } from "@/lib/admin-auth.server";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { isLifetimeVipEmail } from "@/lib/lifetime-vip";
import { z } from "zod";
import { isPaidSubscriptionActive, membershipEnvironment } from "@/lib/membership.server";

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        const url = new URL(request.url);
        const userId = url.searchParams.get("user_id");
        const environment = membershipEnvironment(request);

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
           const { data: subscriptions } = await supabaseAdmin
             .from("subscriptions")
             .select("user_id,status,current_period_end,price_id,environment")
             .eq("environment", environment)
             .order("created_at", { ascending: false });
           const { data: adjustments } = await supabaseAdmin
             .from("membership_adjustments")
             .select("user_id,ends_at")
             .gt("ends_at", new Date().toISOString());
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
           const users = (profiles ?? []).map((p) => ({
             ...p,
             ...(stat[p.user_id] ?? { total: 0, correct: 0, last: null, mocks: 0 }),
              subscription: (subscriptions ?? []).find((s) => s.user_id === p.user_id && isPaidSubscriptionActive(s)) ?? (subscriptions ?? []).find((s) => s.user_id === p.user_id) ?? null,
             gifted_until: (adjustments ?? []).filter((a) => a.user_id === p.user_id).sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0]?.ends_at ?? null,
             is_lifetime_vip: isLifetimeVipEmail(p.email),
           }));
          return Response.json({ users });
        }

        // 详情
         const [{ data: profile }, { data: attempts }, { data: mocks }, { data: wrongs }, { data: subscriptions }, { data: usage }, { data: adjustments }] = await Promise.all([
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
            .select("question_id,added_at,source")
            .eq("user_id", userId),
           supabaseAdmin.from("subscriptions").select("*").eq("user_id", userId).eq("environment", environment).order("created_at", { ascending: false }),
           supabaseAdmin.from("ai_daily_usage").select("usage_date,ai_explain_count,frq_grade_count").eq("user_id", userId).order("usage_date", { ascending: false }).limit(30),
           supabaseAdmin.from("membership_adjustments").select("days_granted,starts_at,ends_at,note,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
        ]);
        const qIds = Array.from(
          new Set([...(attempts ?? []).map((a) => a.question_id), ...(wrongs ?? []).map((w) => w.question_id)]),
        );
         const qMap: Record<string, { stem: string; correct_answer: string }> = {};
        if (qIds.length) {
          const { data: qs } = await supabaseAdmin
            .from("questions")
            .select("id,stem,correct_answer")
            .in("id", qIds);
          (qs ?? []).forEach((q) => (qMap[q.id] = { stem: q.stem, correct_answer: q.correct_answer }));
        }
         return Response.json({ profile, attempts, mocks, wrongs, questions: qMap, subscriptions, usage, adjustments });
      },
       POST: async ({ request }) => {
         if (!(await verifyAdminRequest(request))) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
         const admin = await verifyUserRequest(request);
         if (!admin) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
         const parsed = z.object({
           user_id: z.string().uuid(),
           days: z.number().int().min(1).max(3660),
           note: z.string().max(200).optional(),
         }).safeParse(await request.json());
         if (!parsed.success) return Response.json({ error: "invalid fields" }, { status: 400 });
         const now = new Date();
          const [{ data: latest }, { data: paid }] = await Promise.all([
            supabaseAdmin.from("membership_adjustments").select("ends_at").eq("user_id", parsed.data.user_id).gt("ends_at", now.toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
            supabaseAdmin.from("subscriptions").select("status,current_period_end").eq("user_id", parsed.data.user_id).eq("environment", membershipEnvironment(request)).in("status", ["active", "trialing", "canceled"]).gt("current_period_end", now.toISOString()).order("current_period_end", { ascending: false }).limit(1).maybeSingle(),
          ]);
          const candidates = [now.getTime(), latest ? new Date(latest.ends_at).getTime() : 0, paid?.current_period_end ? new Date(paid.current_period_end).getTime() : 0];
          const startsAt = new Date(Math.max(...candidates));
         const endsAt = new Date(startsAt.getTime() + parsed.data.days * 86400000);
         const { error } = await supabaseAdmin.from("membership_adjustments").insert({
           user_id: parsed.data.user_id,
           admin_user_id: admin.userId,
           days_granted: parsed.data.days,
           starts_at: startsAt.toISOString(),
           ends_at: endsAt.toISOString(),
           note: parsed.data.note || null,
         });
         if (error) return Response.json({ error: "save failed" }, { status: 500 });
         return Response.json({ ok: true, ends_at: endsAt.toISOString() });
       },
    },
  },
});