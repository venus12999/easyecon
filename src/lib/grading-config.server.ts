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

export function gradingConcurrency() {
  return boundedInt(process.env.GRADING_CONCURRENCY, 3, 1, 8);
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
