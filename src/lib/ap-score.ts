/**
 * AP Microeconomics composite, out of 90.
 * Multiple choice is two thirds (60). Free response is one third (30).
 * Cut scores follow recent College Board practice-exam worksheets.
 * A live exam's curve moves a little from year to year.
 */
export const AP_COMPOSITE_MAX = 90;
export const AP_MCQ_WEIGHT = 60;
export const AP_FRQ_WEIGHT = 30;
export const CUSTOM_SCORE_MAX_DEFAULT = 100;

export function scoreMaxError(value: number) {
  if (!Number.isInteger(value) || value < 10 || value > 300) return "满分请设在 10 到 300 分之间";
  return null;
}

/** Scale the 90-point composite onto the full score the teacher chose. */
export function pointsOnScale(composite: number | null, scoreMax: number | null | undefined) {
  if (composite == null || scoreMax == null || scoreMax < 1) return null;
  return Math.min(scoreMax, Math.max(0, Math.round((composite / AP_COMPOSITE_MAX) * scoreMax)));
}

export type ApScoreValue = 1 | 2 | 3 | 4 | 5;

export type ApScoreInput = {
  mcqCorrect: number | null;
  mcqTotal: number | null;
  frqEarned: number | null;
  frqMax: number | null;
};

export type ApScore = {
  score: ApScoreValue | null;
  composite: number | null;
  compositeMax: number;
  mcqWeighted: number | null;
  frqWeighted: number | null;
  basis: "full" | "mcq-only" | "frq-only" | null;
  reason: "ready" | "no-scores" | "frq-pending" | "mcq-pending";
};

export function apScoreFromComposite(composite: number): ApScoreValue {
  const score = Math.round(composite);
  if (score >= 70) return 5;
  if (score >= 57) return 4;
  if (score >= 45) return 3;
  if (score >= 36) return 2;
  return 1;
}

function weighted(earned: number, max: number, weight: number) {
  if (max <= 0) return 0;
  return (Math.max(0, earned) / max) * weight;
}

export function apMicroScore(input: ApScoreInput): ApScore {
  const empty: ApScore = {
    score: null,
    composite: null,
    compositeMax: AP_COMPOSITE_MAX,
    mcqWeighted: null,
    frqWeighted: null,
    basis: null,
    reason: "no-scores",
  };
  const hasMcq = input.mcqTotal != null && input.mcqTotal > 0 && input.mcqCorrect != null;
  const hasFrqSection = input.frqMax != null && input.frqMax > 0;
  const frqReady = hasFrqSection && input.frqEarned != null;
  if (hasFrqSection && input.frqEarned == null) return { ...empty, reason: "frq-pending" };
  if (!hasMcq && hasFrqSection && !frqReady) return { ...empty, reason: "mcq-pending" };
  if (!hasMcq && !frqReady) return empty;

  let mcqWeighted: number | null = null;
  let frqWeighted: number | null = null;
  let composite = 0;
  let basis: ApScore["basis"] = "full";
  if (hasMcq && frqReady) {
    mcqWeighted = weighted(input.mcqCorrect ?? 0, input.mcqTotal ?? 0, AP_MCQ_WEIGHT);
    frqWeighted = weighted(input.frqEarned ?? 0, input.frqMax ?? 0, AP_FRQ_WEIGHT);
    composite = mcqWeighted + frqWeighted;
  } else if (hasMcq) {
    basis = "mcq-only";
    mcqWeighted = weighted(input.mcqCorrect ?? 0, input.mcqTotal ?? 0, AP_COMPOSITE_MAX);
    composite = mcqWeighted;
  } else {
    basis = "frq-only";
    frqWeighted = weighted(input.frqEarned ?? 0, input.frqMax ?? 0, AP_COMPOSITE_MAX);
    composite = frqWeighted;
  }
  const rounded = Math.round(composite);
  return {
    score: apScoreFromComposite(rounded),
    composite: rounded,
    compositeMax: AP_COMPOSITE_MAX,
    mcqWeighted: mcqWeighted == null ? null : Math.round(mcqWeighted),
    frqWeighted: frqWeighted == null ? null : Math.round(frqWeighted),
    basis,
    reason: "ready",
  };
}

export function apScoreText(result: ApScore) {
  if (result.score == null) {
    if (result.reason === "frq-pending") return "待大题出分";
    if (result.reason === "mcq-pending") return "待选择题出分";
    return "—";
  }
  return String(result.score);
}

export type ApClassSummary = {
  average: number | null;
  scored: number;
  pending: number;
  counts: Record<ApScoreValue, number>;
  best: ApScoreValue | null;
  scoreMax: number | null;
  averageCustom: number | null;
  bestCustom: number | null;
};

export function summarizeApScores(results: ApScore[], scoreMax?: number | null): ApClassSummary {
  const counts: Record<ApScoreValue, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let scored = 0;
  let pending = 0;
  let best: ApScoreValue | null = null;
  let customSum = 0;
  let customCount = 0;
  let bestCustom: number | null = null;
  const max = scoreMax != null && scoreMax > 0 ? scoreMax : null;
  for (const result of results) {
    if (result.reason === "frq-pending" || result.reason === "mcq-pending") pending += 1;
    if (result.score == null) continue;
    counts[result.score] += 1;
    sum += result.score;
    scored += 1;
    if (best == null || result.score > best) best = result.score;
    const custom = pointsOnScale(result.composite, max);
    if (custom == null) continue;
    customSum += custom;
    customCount += 1;
    if (bestCustom == null || custom > bestCustom) bestCustom = custom;
  }
  return {
    average: scored ? Math.round((sum / scored) * 10) / 10 : null,
    scored,
    pending,
    counts,
    best,
    scoreMax: max,
    averageCustom: customCount ? Math.round((customSum / customCount) * 10) / 10 : null,
    bestCustom,
  };
}

export function formatScaledScore(points: number | null | undefined, scoreMax: number | null | undefined) {
  if (points == null || !scoreMax) return "—";
  const shown = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return `${shown}/${scoreMax}`;
}

export function apDistributionText(summary: ApClassSummary) {
  return ([5, 4, 3, 2, 1] as ApScoreValue[])
    .map((score) => `${score}分 ${summary.counts[score]}人`)
    .join(" · ");
}

export function apBasisText(basis: ApScore["basis"]) {
  if (basis === "mcq-only") return "这份卷没有大题，按选择题正确率折成 1–5。";
  if (basis === "frq-only") return "这份卷没有选择题，按大题得分折成 1–5。";
  return "选择题占三分之二，大题占三分之一。";
}
