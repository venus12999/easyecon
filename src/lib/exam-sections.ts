export const MCQ_MINUTES_DEFAULT = 70;
export const FRQ_MINUTES_DEFAULT = 60;
export const BREAK_MINUTES_DEFAULT = 10;

export function sectionMinutesError(mcq: number, frq: number, breakMinutes: number) {
  if (!Number.isInteger(mcq) || mcq < 1 || mcq > 180) return "选择题时长请设在 1 到 180 分钟之间";
  if (frq !== 0 && (!Number.isInteger(frq) || frq < 10 || frq > 180)) return "大题时长请设为 0，或 10 到 180 分钟";
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 20) return "休息时长请设在 0 到 20 分钟之间";
  if (frq === 0 && breakMinutes !== 0) return "没有大题时不设休息";
  return null;
}

export function sectionTotalMinutes(mcq: number, frq: number, breakMinutes: number) {
  return mcq + (frq > 0 ? frq + breakMinutes : 0);
}

export function sectionTimingLabel(mcqSeconds: number | null | undefined, frqSeconds: number | null | undefined, breakSeconds: number | null | undefined) {
  if (mcqSeconds == null) return null;
  const mcq = Math.round(mcqSeconds / 60);
  const frq = Math.round((frqSeconds ?? 0) / 60);
  const breakMinutes = Math.round((breakSeconds ?? 0) / 60);
  if (frq <= 0) return `选择题 ${mcq} 分钟`;
  return `选择题 ${mcq} 分钟 + 大题 ${frq} 分钟${breakMinutes ? `，休息 ${breakMinutes} 分钟` : ""}`;
}
