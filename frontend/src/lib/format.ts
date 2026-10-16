// Fixed product conventions: ISO calendar dates and a 24-hour clock,
// whatever the device locale.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseTimestamp(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A calendar date (YYYY-MM-DD) as-is, or a timestamp's local date in ISO form. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const calendar = CALENDAR_DATE.exec(value);
  if (calendar) return value;
  const date = parseTimestamp(value);
  if (!date) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A timestamp's local time as HH:mm. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = parseTimestamp(value);
  if (!date) return value;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A timestamp as YYYY-MM-DD HH:mm in local time. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = parseTimestamp(value);
  if (!date) return value;
  return `${formatDate(value)} ${formatTime(value)}`;
}
