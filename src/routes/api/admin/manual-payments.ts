import { createFileRoute } from "@tanstack/react-router";
import { verifyAdminRequest } from "@/lib/admin-auth.server";
import { PAY_PLANS, isPayPlanKey, membershipDaysFor } from "@/lib/pay-plans";

function unauth() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export const Route = createFileRoute("/api/admin/manual-payments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("manual_payments")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 400 });
        const rows = data ?? [];
        const emails = new Map<string, string | null>();
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id,email,display_name")
          .in("user_id", rows.map((row) => row.user_id));
        for (const profile of profiles ?? []) emails.set(profile.user_id, profile.display_name || profile.email);
        const items = await Promise.all(
          rows.map(async (row) => {
            let proofUrl: string | null = null;
            if (row.proof_path) {
              const signed = await supabaseAdmin.storage.from("payment-proofs").createSignedUrl(row.proof_path, 3600);
              proofUrl = signed.data?.signedUrl ?? null;
            }
            return { ...row, proofUrl, userLabel: emails.get(row.user_id) ?? row.user_id };
          }),
        );
        return Response.json({ items });
      },
      PUT: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) return unauth();
        const body = (await request.json()) as { id?: string; action?: string; reviewNote?: string };
        if (!body.id || (body.action !== "approve" && body.action !== "reject")) {
          return Response.json({ error: "invalid request" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: payment, error: loadError } = await supabaseAdmin
          .from("manual_payments")
          .select("*")
          .eq("id", body.id)
          .maybeSingle();
        if (loadError || !payment) return Response.json({ error: "not found" }, { status: 404 });
        if (payment.status !== "pending") return Response.json({ error: "already reviewed" }, { status: 409 });

        if (body.action === "approve") {
          if (!isPayPlanKey(payment.plan_key)) return Response.json({ error: "unknown plan" }, { status: 400 });
          const plan = PAY_PLANS[payment.plan_key];
          const days = membershipDaysFor(plan, payment.quantity);
          const now = new Date();
          let endsAt: string | null = null;
          if (days > 0) {
            endsAt = new Date(now.getTime() + days * 86400000).toISOString();
            const { error: giftError } = await supabaseAdmin.from("membership_adjustments").insert({
              user_id: payment.user_id,
              admin_user_id: payment.user_id,
              days_granted: days,
              starts_at: now.toISOString(),
              ends_at: endsAt,
              note: `manual:${payment.plan_key}:qty${payment.quantity}:${payment.order_no}`,
            });
            if (giftError) return Response.json({ error: giftError.message }, { status: 400 });
          }
          if (plan.kind === "tutor") {
            const { error: orderError } = await supabaseAdmin.from("tutor_orders").upsert({
              user_id: payment.user_id,
              paddle_transaction_id: `manual_${payment.order_no}`,
              price_external_id: plan.key,
              quantity: payment.quantity,
              amount_total: payment.amount_cny,
              currency_code: "CNY",
              status: "completed",
              membership_days_granted: days,
              membership_ends_at: endsAt,
              environment: "live",
              updated_at: now.toISOString(),
            }, { onConflict: "paddle_transaction_id" });
            if (orderError) return Response.json({ error: orderError.message }, { status: 400 });
          }
        }

        const { error } = await supabaseAdmin
          .from("manual_payments")
          .update({
            status: body.action === "approve" ? "approved" : "rejected",
            review_note: typeof body.reviewNote === "string" ? body.reviewNote.slice(0, 300) : null,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", body.id);
        if (error) return Response.json({ error: error.message }, { status: 400 });
        return Response.json({ ok: true });
      },
    },
  },
});