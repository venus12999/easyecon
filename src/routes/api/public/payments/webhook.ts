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

type TransactionEventData = {
  id: string;
  status: string;
  subscriptionId?: string | null;
  customData?: { userId?: string } | null;
  items?: Array<{ quantity?: number; price?: { productId?: string; importMeta?: { externalId?: string } } }>;
  details?: { totals?: { total?: string; currencyCode?: string } };
};

function membershipDaysFor(priceId: string, quantity: number): number {
  if (priceId === "tutor_pack_10") return 30;
  if (priceId === "tutor_pack_30") return 90;
  if (priceId === "tutor_single_lesson" && quantity >= 5) return 14;
  return 0;
}

async function transactionCompleted(data: TransactionEventData, environment: PaddleEnv) {
  const userId = data.customData?.userId;
  const item = data.items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const quantity = item?.quantity ?? 1;
  if (!userId || !priceId) {
    console.warn("Skipping transaction with incomplete metadata", { txId: data.id });
    return;
  }
  // Only tutor purchases go into tutor_orders; membership subs are handled elsewhere.
  if (!priceId.startsWith("tutor_")) return;

  const admin = getAdminClient();
  const days = membershipDaysFor(priceId, quantity);
  const totalMinor = data.details?.totals?.total;
  const amount = totalMinor ? Number(totalMinor) / 100 : null;

  let membershipEndsAt: string | null = null;
  if (days > 0) {
    const now = new Date();
    const ends = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    membershipEndsAt = ends.toISOString();
    const { error: mErr } = await admin.from("membership_adjustments").insert({
      user_id: userId,
      admin_user_id: userId,
      days_granted: days,
      starts_at: now.toISOString(),
      ends_at: membershipEndsAt,
      note: `tutor:${priceId}:qty${quantity}:tx_${data.id}`,
    });
    if (mErr) console.error("Failed to grant tutor membership", mErr);
  }

  const { error } = await admin.from("tutor_orders").upsert({
    user_id: userId,
    paddle_transaction_id: data.id,
    paddle_subscription_id: data.subscriptionId ?? null,
    price_external_id: priceId,
    product_external_id: item?.price?.productId ?? null,
    quantity,
    amount_total: amount,
    currency_code: data.details?.totals?.currencyCode ?? null,
    status: data.status,
    membership_days_granted: days,
    membership_ends_at: membershipEndsAt,
    environment,
    updated_at: new Date().toISOString(),
  }, { onConflict: "paddle_transaction_id" });
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
          if (event.eventType === EventName.TransactionCompleted) await transactionCompleted(event.data as TransactionEventData, rawEnv);
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