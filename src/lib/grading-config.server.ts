const DEFAULT_BASE_URL = "https://api2.laozhang.ai/v1";
const DEFAULT_MODEL = "gemini-2.5-flash";

/** Models a teacher deploy can select with GRADING_MODEL. The default stays flash. */
export const GRADING_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-nothinking",
  "gemini-2.5-flash-lite",
  "gpt-4o-mini",
] as const;

export const GRADING_TIMEOUT_MS = 45_000;

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function gradingBaseUrl() {
  const raw = (process.env.GRADING_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\/\S+$/i.test(raw)) return DEFAULT_BASE_URL;
  return raw;
}

export function gradingModel() {
  const requested = (process.env.GRADING_MODEL ?? DEFAULT_MODEL).trim();
  return (GRADING_MODELS as readonly string[]).includes(requested) ? requested : DEFAULT_MODEL;
}

/**
 * LaoZhang does not cap account RPM or concurrency. A 429 comes from the upstream model.
 * Grading stays at one request so a limit does not turn into a retry loop.
 */
export function gradingConcurrency() {
  return boundedInt(process.env.GRADING_CONCURRENCY, 1, 1, 4);
}

/** Seconds or an HTTP date. Unusable values are ignored so the caller can fall back to exponential wait. */
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

/** Retry-After when the upstream sent one. Otherwise 20s, 40s, 80s, then 120s, plus a few seconds of jitter. */
export function rateLimitWaitMs(previousTries: number, headerMs: number | null) {
  const jitter = 1000 + Math.floor(Math.random() * 4000);
  if (headerMs != null && headerMs >= 1000) return Math.min(180_000, headerMs + jitter);
  const step = Math.min(3, Math.max(0, previousTries));
  return Math.min(120_000, 20_000 * 2 ** step) + jitter;
}

export function gradingMaxRetries() {
  return boundedInt(process.env.GRADING_MAX_RETRIES, 4, 1, 8);
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
