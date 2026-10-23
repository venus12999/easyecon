/** Exam clocks are Beijing time, even when the computer is set to another zone. */
export function beijingTime(iso: string | number | Date | null | undefined) {
  if (iso == null || iso === "") return "";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (!Number.isFinite(hour)) hour = 0;
  const period = pick("dayPeriod").toLowerCase();
  if ((period.startsWith("pm") || period.includes("下午")) && hour < 12) hour += 12;
  if ((period.startsWith("am") || period.includes("上午")) && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  const pad = (value: number | string) => String(value).padStart(2, "0");
  return `${pick("year")}-${pad(pick("month"))}-${pad(pick("day"))} ${pad(hour)}:${pad(pick("minute"))}:${pad(pick("second"))}`;
}

/** datetime-local values are the Beijing wall clock the teacher picked, not the computer zone. */
export function beijingInputToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

export function toBeijingInput(iso: string | number | Date) {
  const formatted = beijingTime(iso);
  const match = formatted.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}`;
}

/** Show a picker value as 24-hour Beijing digits, without an AM/PM conversion. */
export function beijingInputLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return beijingTime(value).slice(0, 16);
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
