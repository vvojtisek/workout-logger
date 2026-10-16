const DATE_TIME_INPUT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return (
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() === Number(month) - 1 &&
    parsed.getDate() === Number(day)
  );
}

/** Convert a timestamp to a local, locale-independent YYYY-MM-DD HH:mm field value. */
export function toLocalDateTimeInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert strict local YYYY-MM-DD HH:mm input to the existing UTC API timestamp. */
export function localDateTimeInputToIso(value: string): string {
  const match = DATE_TIME_INPUT.exec(value);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const numbers = [year, month, day, hour, minute].map(Number);
  const [y, m, d, h, min] = numbers;
  if (h > 23 || min > 59 || !isIsoCalendarDate(`${year}-${month}-${day}`)) return "";
  const local = new Date(y, m - 1, d, h, min);
  return local.getFullYear() === y &&
    local.getMonth() === m - 1 &&
    local.getDate() === d &&
    local.getHours() === h &&
    local.getMinutes() === min
    ? local.toISOString()
    : "";
}

export function nowAsLocalDateTimeInput(now = new Date()): string {
  return toLocalDateTimeInput(now);
}
