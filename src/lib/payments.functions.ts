import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({
      priceId: z.enum([
        "ap_micro_pro_monthly",
        "ap_micro_pro_quarterly",
        "ap_micro_pro_yearly",
        "tutor_single_lesson",
        "tutor_pack_10",
      ]),
      environment: z.enum(["sandbox", "live"]),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(data.environment, `/prices?external_id=${encodeURIComponent(data.priceId)}`);
    if (!response.ok) throw new Error("Price lookup failed");
    const result = (await response.json()) as { data?: Array<{ id: string }> };
    const id = result.data?.[0]?.id;
    if (!id) throw new Error("Price not found");
    return id;
  });