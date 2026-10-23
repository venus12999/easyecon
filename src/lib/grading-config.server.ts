type GradingProvider = "deepseek" | "qwen";

const PROVIDERS: Record<GradingProvider, { baseUrl: string; model: string; keyEnv: "DEEPSEEK_API_KEY" | "QWEN_API_KEY" }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    keyEnv: "DEEPSEEK_API_KEY",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-plus",
    keyEnv: "QWEN_API_KEY",
  },
};

const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-flash"];
const RETRY_STEPS_MS = [5_000, 15_000, 45_000, 120_000];

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** deepseek is live. qwen is the spare slot and is not selected unless GRADING_PROVIDER=qwen. */
export function gradingProvider(): GradingProvider {
  return (process.env.GRADING_PROVIDER ?? "deepseek").trim().toLowerCase() === "qwen" ? "qwen" : "deepseek";
}

export function gradingBaseUrl() {
  const fallback = PROVIDERS[gradingProvider()].baseUrl;
  const raw = (process.env.GRADING_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw || /laozhang\.ai|gateway\.lovable\.dev|generativelanguage\.googleapis\.com/i.test(raw)) return fallback;
  if (!/^https:\/\/\S+$/i.test(raw)) return fallback;
  return raw;
}

export function gradingHost() {
  try {
    return new URL(gradingBaseUrl()).host;
  } catch {
    return "api.deepseek.com";
  }
}

/** deepseek-v4-pro cannot read images, so a Pro setting still grades with flash. */
export function gradingModel() {
  const provider = gradingProvider();
  const fallback = PROVIDERS[provider].model;
  const requested = (process.env.GRADING_MODEL ?? "").trim();
  if (!requested) return fallback;
  if (provider === "deepseek") {
    if (/v4-pro/i.test(requested) || !DEEPSEEK_MODELS.includes(requested)) return "deepseek-flash";
    return requested;
  }
  return requested;
}

export function gradingApiKey() {
  const value = process.env[PROVIDERS[gradingProvider()].keyEnv];
  return typeof value === "string" ? value.trim() : "";
}

export function gradingTimeoutMs() {
  return boundedInt(process.env.GRADING_TIMEOUT_MS, 90_000, 15_000, 180_000);
}

export function gradingConcurrency() {
  return boundedInt(process.env.GRADING_CONCURRENCY, 10, 1, 20);
}

export function gradingMaxRetries() {
  return boundedInt(process.env.GRADING_MAX_RETRIES, 4, 1, 8);
}

/** Seconds or an HTTP date. Unusable values are ignored so the caller can fall back. */
export function parseRetryAfter(header: string | null) {
  const raw = header?.trim() ?? "";
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const ms = Math.round(Number(raw) * 1000);
    return ms >= 1000 && ms <= 15 * 60_000 ? ms : null;
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const ms = at - Date.now();
  return ms >= 1000 && ms <= 15 * 60_000 ? ms : null;
}

/** Retry-After when the upstream sent one. Otherwise 5s, 15s, 45s, then 2 minutes. */
export function retryWaitMs(previousTries: number, headerMs: number | null) {
  if (headerMs != null && headerMs >= 1000) return Math.min(10 * 60_000, headerMs);
  const step = Math.min(RETRY_STEPS_MS.length - 1, Math.max(0, previousTries));
  return RETRY_STEPS_MS[step] ?? 120_000;
}

export function rateLimitWaitMs(previousTries: number, headerMs: number | null) {
  return retryWaitMs(previousTries, headerMs);
}

let activeGrades = 0;
const waiters: Array<() => void> = [];

export function gradingSlotsAvailable() {
  return Math.max(0, gradingConcurrency() - activeGrades);
}

/** Cap in-flight grading calls for this process. The key never leaves the server. */
export async function withGradingSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeGrades >= gradingConcurrency()) {
    await new Promise<void>((resolve) => {
      waiters.push(() => {
        activeGrades += 1;
        resolve();
      });
    });
  } else {
    activeGrades += 1;
  }
  try {
    return await work();
  } finally {
    activeGrades -= 1;
    waiters.shift()?.();
  }
}
