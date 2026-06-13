import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { EventName, verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backend is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function created(data: any, environment: PaddleEnv) {
  const userId = data.customData?.userId;
  const item = data.items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const productId = item?.product?.importMeta?.externalId;
  if (!userId || !priceId || !productId) {
    console.warn("Skipping subscription with incomplete membership metadata");
    return;
  }
  const { error } = await getAdminClient().from("subscriptions").upsert({
    user_id: userId,
    paddle_subscription_id: data.id,
    paddle_customer_id: data.customerId,
    product_id: productId,
    price_id: priceId,
    status: data.status,
    current_period_start: data.currentBillingPeriod?.startsAt ?? null,
    current_period_end: data.currentBillingPeriod?.endsAt ?? null,
    environment,
    updated_at: new Date().toISOString(),
  }, { onConflict: "paddle_subscription_id" });
  if (error) throw error;
}

async function updated(data: any, environment: PaddleEnv, canceled = false) {
  const { error } = await getAdminClient().from("subscriptions").update({
    status: canceled ? "canceled" : data.status,
    current_period_start: data.currentBillingPeriod?.startsAt ?? null,
    current_period_end: data.currentBillingPeriod?.endsAt ?? null,
    cancel_at_period_end: data.scheduledChange?.action === "cancel",
    updated_at: new Date().toISOString(),
  }).eq("paddle_subscription_id", data.id).eq("environment", environment);
  if (error) throw error;
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") return new Response("Invalid environment", { status: 400 });
        try {
          const event = await verifyWebhook(request, rawEnv);
          if (event.eventType === EventName.SubscriptionCreated) await created(event.data, rawEnv);
          if (event.eventType === EventName.SubscriptionUpdated) await updated(event.data, rawEnv);
          if (event.eventType === EventName.SubscriptionCanceled) await updated(event.data, rawEnv, true);
          return Response.json({ received: true });
        } catch (error) {
          console.error("Payment webhook failed", error);
          return new Response("Invalid webhook", { status: 400 });
        }
      },
    },
  },
});