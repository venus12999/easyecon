import { Environment, EventName, Paddle } from "@paddle/paddle-node-sdk";

export { EventName };
export type PaddleEnv = "sandbox" | "live";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function connectionKey(environment: PaddleEnv) {
  return requireEnv(environment === "sandbox" ? "PADDLE_SANDBOX_API_KEY" : "PADDLE_LIVE_API_KEY");
}

export function getPaddleClient(environment: PaddleEnv) {
  const key = connectionKey(environment);
  return new Paddle(key, {
    environment: "https://connector-gateway.lovable.dev/paddle" as unknown as Environment,
    customHeaders: {
      "X-Connection-Api-Key": key,
      "Lovable-API-Key": requireEnv("LOVABLE_API_KEY"),
    },
  });
}

export async function gatewayFetch(environment: PaddleEnv, path: string) {
  const key = connectionKey(environment);
  return fetch(`https://connector-gateway.lovable.dev/paddle${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Connection-Api-Key": key,
      "Lovable-API-Key": requireEnv("LOVABLE_API_KEY"),
    },
  });
}

export async function verifyWebhook(request: Request, environment: PaddleEnv) {
  const signature = request.headers.get("paddle-signature");
  const body = await request.text();
  const secret = requireEnv(
    environment === "sandbox" ? "PAYMENTS_SANDBOX_WEBHOOK_SECRET" : "PAYMENTS_LIVE_WEBHOOK_SECRET",
  );
  if (!signature || !body) throw new Error("Missing webhook signature or body");
  return getPaddleClient(environment).webhooks.unmarshal(body, secret, signature);
}