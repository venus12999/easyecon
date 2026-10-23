export type FrqPoint = {
  point: string;
  awarded: boolean;
  comment: string;
  points?: number;
  earned?: number;
};

export type FrqPart = {
  key: string;
  label: string;
  max: number;
  max_known: boolean;
  ai_earned: number | null;
  points: FrqPoint[];
};

const PART_KEYS = ["a", "b", "c", "d", "e"] as const;

/** Fit rubric point values onto the question's real full score. Earned points move with them. */
export function scalePointsToMax<T extends { points?: number; earned?: number }>(items: T[], maxScore: number): T[] {
  if (maxScore < 1) return items;
  const weights = items.map((item) => (typeof item.points === "number" && item.points > 0 ? item.points : 0));
  const sum = weights.reduce((total, points) => total + points, 0);
  if (sum < 1 || sum === maxScore) return items;
  const exact = weights.map((points) => (points / sum) * maxScore);
  const next = exact.map((value) => Math.floor(value));
  let left = maxScore - next.reduce((total, points) => total + points, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value), weight: weights[index] }))
    .sort((a, b) => b.frac - a.frac || b.weight - a.weight);
  for (const row of order) {
    if (left <= 0) break;
    if (row.weight <= 0) continue;
    next[row.index] += 1;
    left -= 1;
  }
  return items.map((item, index) => {
    const points = weights[index];
    if (points <= 0) return item;
    const scaled = next[index];
    const earned = typeof item.earned === "number"
      ? Math.max(0, Math.min(scaled, Math.round((item.earned / points) * scaled)))
      : item.earned;
    return { ...item, points: scaled, earned };
  });
}

export function partLabel(key: string) {
  return `${key.toUpperCase()} 问`;
}

/** A part marker only counts at the start of a scoring line, so a later mention of part (a) does not move the point. */
export function partKeyFromText(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:第\s*)?[（(]\s*([a-e])\s*[）)](?:\s*问)?/i)
    ?? trimmed.match(/^([a-e])\s*问/i)
    ?? trimmed.match(/^第\s*([a-e])\s*问/i)
    ?? trimmed.match(/^(?:part)\s+([a-e])\b/i);
  const key = match?.[1]?.toLowerCase();
  return key && PART_KEYS.includes(key as (typeof PART_KEYS)[number]) ? key : null;
}

export function partKeysInText(text: string) {
  const keys: string[] = [];
  const re = /(?:^|\n)\s*(?:第\s*)?[（(]\s*([a-e])\s*[）)]/gi;
  for (const match of text.matchAll(re)) {
    const key = match[1]?.toLowerCase();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function pointsInPart(text: string, key: string) {
  const marks: { key: string; index: number }[] = [];
  const re = /(?:^|\n)\s*(?:第\s*)?[（(]\s*([a-e])\s*[）)]/gi;
  for (const match of text.matchAll(re)) {
    if (match.index == null || !match[1]) continue;
    marks.push({ key: match[1].toLowerCase(), index: match.index });
  }
  const start = marks.find((item) => item.key === key);
  if (!start) return null;
  const next = marks.find((item) => item.index > start.index);
  const slice = text.slice(start.index, next?.index ?? text.length);
  const scores = [...slice.matchAll(/[（(]\s*(\d+)\s*(?:分|points?)\s*[）)]/gi)].map((item) => Number(item[1]));
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0);
}

function bucketMax(points: FrqPoint[]) {
  const valued = points.filter((item) => typeof item.points === "number" && item.points > 0);
  if (valued.length > 0) return valued.reduce((sum, item) => sum + (item.points ?? 0), 0);
  return points.length;
}

function bucketEarned(points: FrqPoint[]) {
  const pending = points.every((item) => item.earned == null && item.comment === "还没有逐条分数");
  if (pending) return null;
  return points.reduce((sum, item) => {
    if (typeof item.earned === "number") return sum + item.earned;
    if (item.comment === "还没有逐条分数") return sum;
    const value = typeof item.points === "number" && item.points > 0 ? item.points : 1;
    return sum + (item.awarded ? value : 0);
  }, 0);
}

function partFromPoints(key: string, points: FrqPoint[]): FrqPart {
  return {
    key,
    label: partLabel(key),
    max: bucketMax(points),
    max_known: true,
    ai_earned: bucketEarned(points),
    points,
  };
}

/** Split a free-response question into A/B/C parts. Fewer than two parts means the teacher still scores the whole question. */
export function groupFrqParts(input: {
  breakdown?: FrqPoint[] | null;
  content?: string | null;
  rubric?: string | null;
  maxScore: number;
}): FrqPart[] {
  const breakdown = input.breakdown ?? [];
  const letters = breakdown.map((item) => partKeyFromText(item.point));
  if (letters.some(Boolean)) {
    let current = letters.find((key): key is string => !!key) ?? "a";
    const order: string[] = [];
    const buckets = new Map<string, FrqPoint[]>();
    breakdown.forEach((item, index) => {
      const found = letters[index];
      if (found) current = found;
      if (!buckets.has(current)) order.push(current);
      buckets.set(current, [...(buckets.get(current) ?? []), item]);
    });
    const parts = order.map((key) => partFromPoints(key, buckets.get(key) ?? []));
    return parts.length >= 2 ? parts : [];
  }

  const keys = partKeysInText(`${input.rubric ?? ""}\n${input.content ?? ""}`);
  if (keys.length < 2) return [];
  return keys.map((key) => {
    const listed = pointsInPart(input.rubric ?? "", key) ?? pointsInPart(input.content ?? "", key);
    return {
      key,
      label: partLabel(key),
      max: listed && listed > 0 ? listed : Math.max(0, input.maxScore),
      max_known: !!(listed && listed > 0),
      ai_earned: null,
      points: [] as FrqPoint[],
    };
  });
}

export function resolvePartOverride(
  parts: FrqPart[],
  incoming: Record<string, number | null> | undefined,
  questionMax: number,
  sortOrder: number,
) {
  if (!incoming || parts.length < 2) return { manual_score: null as number | null, manual_parts: null as Record<string, number> | null, error: null as string | null, used: false };
  const specified = parts.some((part) => typeof incoming[part.key] === "number");
  if (!specified) return { manual_score: null, manual_parts: null, error: null, used: true };
  if (questionMax < 1) return { manual_score: null, manual_parts: null, error: `第 ${sortOrder} 题没有满分，请先填写再改分`, used: true };
  const resolved: Record<string, number> = {};
  let sum = 0;
  for (const part of parts) {
    const raw = incoming[part.key];
    const cap = part.max_known ? Math.min(part.max, questionMax) : questionMax;
    if (typeof raw === "number") {
      if (!Number.isInteger(raw) || raw < 0 || raw > cap) {
        return { manual_score: null, manual_parts: null, error: `第 ${sortOrder} 题${part.label}的分数要在 0 到 ${cap} 之间`, used: true };
      }
      resolved[part.key] = raw;
    } else {
      const fallback = part.ai_earned ?? 0;
      resolved[part.key] = Math.max(0, Math.min(cap, fallback));
    }
    sum += resolved[part.key] ?? 0;
  }
  if (sum > questionMax) {
    return { manual_score: null, manual_parts: null, error: `第 ${sortOrder} 题各小问加起来是 ${sum}，不能超过满分 ${questionMax}`, used: true };
  }
  return { manual_score: sum, manual_parts: resolved, error: null, used: true };
}
