import { useState } from "react";
import { getPaddlePriceId, initializePaddle } from "@/lib/paddle";
import { toast } from "sonner";

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
    } catch (error) {
      console.error("Unable to open checkout", error);
      toast.error("暂时无法打开结账，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return { openCheckout, loading };
}