// 游客本地存储：进度、错题本
const PROGRESS_KEY = "ap-econ-progress-v1";
const WRONG_KEY = "ap-econ-wrong-v1";

export type KpProgress = { attempts: number; correct: number };
export type ProgressMap = Record<string, KpProgress>;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getProgress(): ProgressMap {
  return read<ProgressMap>(PROGRESS_KEY, {});
}
export function recordAnswer(kpId: string, correct: boolean) {
  const p = getProgress();
  const cur = p[kpId] ?? { attempts: 0, correct: 0 };
  cur.attempts += 1;
  if (correct) cur.correct += 1;
  p[kpId] = cur;
  write(PROGRESS_KEY, p);
}

export function getWrong(): string[] {
  return read<string[]>(WRONG_KEY, []);
}
export function addWrong(qid: string) {
  const cur = new Set(getWrong());
  cur.add(qid);
  write(WRONG_KEY, Array.from(cur));
}
export function removeWrong(qid: string) {
  const cur = getWrong().filter((x) => x !== qid);
  write(WRONG_KEY, cur);
}