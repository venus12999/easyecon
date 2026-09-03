import type { FrqAnswerState } from "@/components/frq/FrqAnswerBox";

const KEY = "easyecon:pending-mock";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type PendingBase = {
  v: 1;
  savedAt: number;
  answers: Record<string, string>;
  seconds: number;
  frqAnswers: Record<string, FrqAnswerState>;
};

export type PendingPaperMock = PendingBase & {
  kind: "paper";
  slug: string;
  mode: "exam" | "practice";
};

export type PendingRandomMock = PendingBase & {
  kind: "random";
  questions: unknown[];
  frqs: unknown[];
};

export type PendingMock = PendingPaperMock | PendingRandomMock;

export function savePendingMock(data: Omit<PendingPaperMock, "v" | "savedAt"> | Omit<PendingRandomMock, "v" | "savedAt">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, v: 1, savedAt: Date.now() }));
  } catch {
    // ignore quota / private mode
  }
}

export function loadPendingMock(): PendingMock | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMock;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearPendingMock();
      return null;
    }
    if (parsed.kind !== "paper" && parsed.kind !== "random") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingMock() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
