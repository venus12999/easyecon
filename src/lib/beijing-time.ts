/** Beijing is UTC+8 all year. Do not use Intl: the worker clock ignores the timezone and prints UTC. */
export function beijingTime(iso: string | number | Date | null | undefined) {
  if (iso == null || iso === "") return "";
  const date = iso instanceof Date ? iso : new Date(iso);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "";
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
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
