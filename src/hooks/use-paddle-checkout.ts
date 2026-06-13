import { useState } from "react";
import { getPaddlePriceId, initializePaddle } from "@/lib/paddle";

export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  async function openCheckout(options: { priceId: string; userId: string; email?: string }) {
    setLoading(true);
    try {
      await initializePaddle();
      const priceId = await getPaddlePriceId(options.priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: options.email ? { email: options.email } : undefined,
        customData: { userId: options.userId },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/profile?checkout=success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } finally {
      setLoading(false);
    }
  }

  return { openCheckout, loading };
}