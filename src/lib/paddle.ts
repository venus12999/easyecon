import { resolvePaddlePrice } from "@/lib/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

declare global {
  interface Window {
    Paddle: {
      Environment: { set: (environment: "sandbox" | "production") => void };
      Initialize: (options: { token: string }) => void;
      Checkout: { open: (options: unknown) => void };
    };
  }
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let initialized = false;
export async function initializePaddle() {
  if (initialized) return;
  if (!clientToken) throw new Error("Payments are not configured");
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-paddle="true"]');
    if (existing && window.Paddle) return resolve();
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.dataset.paddle = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load payments"));
    document.head.appendChild(script);
  });
  window.Paddle.Environment.set(getPaddleEnvironment() === "sandbox" ? "sandbox" : "production");
  window.Paddle.Initialize({ token: clientToken });
  initialized = true;
}

export async function getPaddlePriceId(priceId: string) {
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}