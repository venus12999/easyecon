import { useState } from "react";
import { getPaddlePriceId, initializePaddle } from "@/lib/paddle";
import { toast } from "sonner";

export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  async function openCheckout(options: { priceId: string; userId: string; email?: string; quantity?: number }) {
    setLoading(true);
    try {
      await initializePaddle();
      const priceId = await getPaddlePriceId(options.priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: options.quantity ?? 1 }],
        customer: options.email ? { email: options.email } : undefined,
        customData: { userId: options.userId },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/profile?checkout=success`,
          allowLogout: false,
          variant: "one-page",
        },
        eventCallback: (event: { name?: string }) => {
          if (event?.name === "checkout.completed") toast.success("付款已提交，正在同步权益…");
          if (event?.name === "checkout.closed") toast.info("你已关闭结账窗口");
          if (event?.name === "checkout.error" || event?.name === "checkout.payment.failed") {
            toast.error("付款未完成，请重试或更换支付方式");
          }
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