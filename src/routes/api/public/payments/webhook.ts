import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { EventName, verifyWebhook, type PaddleEnv } from "@/lib/paddle.server";

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backend is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type SubscriptionEventData = {
  id: string;
  customerId: string;
  status: string;
  customData?: { userId?: string } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  scheduledChange?: { action?: string } | null;
  items?: Array<{ price?: { importMeta?: { externalId?: string } }; product?: { importMeta?: { externalId?: string } } }>;
};

function externalIds(data: SubscriptionEventData) {
  const item = data.items?.[0];
  return {
    priceId: item?.price?.importMeta?.externalId,
    productId: item?.product?.importMeta?.externalId,
  };
}

async function created(data: SubscriptionEventData, environment: PaddleEnv) {
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

async function updated(data: SubscriptionEventData, environment: PaddleEnv, canceled = false) {
  const { priceId, productId } = externalIds(data);
  const patch: Record<string, unknown> = {
    status: canceled ? "canceled" : data.status,
    current_period_start: data.currentBillingPeriod?.startsAt ?? null,
    current_period_end: data.currentBillingPeriod?.endsAt ?? null,
    cancel_at_period_end: data.scheduledChange?.action === "cancel",
    updated_at: new Date().toISOString(),
  };
  if (priceId) patch.price_id = priceId;
  if (productId) patch.product_id = productId;
  const { error } = await getAdminClient().from("subscriptions").update(patch).eq("paddle_subscription_id", data.id).eq("environment", environment);
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
          console.info("Payment webhook received", { eventId: event.eventId, eventType: event.eventType, environment: rawEnv });
          if (event.eventType === EventName.SubscriptionCreated) await created(event.data as SubscriptionEventData, rawEnv);
          if (event.eventType === EventName.SubscriptionUpdated) await updated(event.data as SubscriptionEventData, rawEnv);
          if (event.eventType === EventName.SubscriptionCanceled) await updated(event.data as SubscriptionEventData, rawEnv, true);
          if (event.eventType === EventName.TransactionPaymentFailed) {
            console.warn("Recurring payment failed", { eventId: event.eventId, environment: rawEnv });
          }
          return Response.json({ received: true });
        } catch (error) {
          console.error("Payment webhook failed", error);
          return new Response("Invalid webhook", { status: 400 });
        }
      },
    },
  },
});