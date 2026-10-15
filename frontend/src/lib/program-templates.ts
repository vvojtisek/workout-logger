/** Monday = 0, matching the API's weekday numbers. */
export const WEEKDAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export function nextMondayIso(from: Date): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const offset = (8 - day.getDay()) % 7; // getDay(): Sunday = 0, Monday = 1
  day.setDate(day.getDate() + offset);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

export function toggleWeekday(
  selected: number[],
  weekday: number,
  max: number,
): number[] {
  if (selected.includes(weekday))
    return selected.filter((day) => day !== weekday);
  if (selected.length >= max) return selected;
  return [...selected, weekday].sort((a, b) => a - b);
}
