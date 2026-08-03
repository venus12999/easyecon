import { createFileRoute } from "@tanstack/react-router";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { PAY_PLANS, amountFor, isPayPlanKey, normalizeQuantity } from "@/lib/pay-plans";

function orderNo() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `EE${stamp}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export const Route = createFileRoute("/api/manual-payments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("manual_payments")
          .select("id,order_no,kind,plan_key,quantity,amount_cny,channel,status,review_note,created_at,reviewed_at")
          .eq("user_id", user.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return Response.json({ error: "query failed" }, { status: 400 });
        return Response.json({ items: data ?? [] });
      },
      POST: async ({ request }) => {
        const user = await verifyUserRequest(request);
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
        const body = (await request.json()) as {
          planKey?: unknown;
          quantity?: unknown;
          channel?: unknown;
          proofPath?: unknown;
          payerNote?: unknown;
        };
        if (!isPayPlanKey(body.planKey)) return Response.json({ error: "invalid plan" }, { status: 400 });
        if (body.channel !== "wechat" && body.channel !== "alipay") return Response.json({ error: "invalid channel" }, { status: 400 });
        const proofPath = typeof body.proofPath === "string" ? body.proofPath : "";
        if (!proofPath.startsWith(`${user.userId}/`) || proofPath.length > 300) {
          return Response.json({ error: "invalid proof" }, { status: 400 });
        }
        const plan = PAY_PLANS[body.planKey];
        const quantity = normalizeQuantity(plan, Number(body.quantity) || 1);
        const note = typeof body.payerNote === "string" ? body.payerNote.slice(0, 300) : null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("manual_payments")
          .insert({
            user_id: user.userId,
            order_no: orderNo(),
            kind: plan.kind,
            plan_key: plan.key,
            quantity,
            amount_cny: amountFor(plan, quantity),
            channel: body.channel,
            proof_path: proofPath,
            payer_note: note,
          })
          .select("order_no")
          .single();
        if (error) {
          console.error("Manual payment insert failed", error);
          return Response.json({ error: "insert failed" }, { status: 400 });
        }
        return Response.json({ orderNo: data.order_no });
      },
    },
  },
});