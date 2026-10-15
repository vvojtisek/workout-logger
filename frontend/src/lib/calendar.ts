import { WEEKDAY_LABELS } from "./program-templates";

/** Calendar weeks run Monday to Sunday, whatever the device locale. */
export const CALENDAR_WEEKDAYS = WEEKDAY_LABELS;

/** Empty cells before the 1st of the month in a Monday-first week grid. */
export function leadingBlankDays(year: number, monthIndex: number): number {
  const sundayFirst = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}
