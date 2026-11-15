import type { GroceryLine, MealType, SupplementTiming } from "@/api/types";
import { localIsoDate } from "./today";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export interface DayOption {
  iso: string;
  /** "Today", "Tomorrow", then "Wed 18/11". */
  label: string;
}

/** The days the kitchen can show: today and the next `count - 1`. */
export function dayOptions(now: Date, count = 7): DayOption[] {
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const weekday = WEEKDAYS[(day.getDay() + 6) % 7];
    const label =
      offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : `${weekday} ${pad(day.getDate())}/${pad(day.getMonth() + 1)}`;
    return { iso: localIsoDate(day), label };
  });
}

/** The last day of a shopping trip that covers `days` days from `start`. */
export function rangeEnd(start: string, days: number): string {
  const [year, month, day] = start.split("-").map(Number);
  return localIsoDate(new Date(year, month - 1, day + days - 1));
}

/** "180 g", "1.5 tbsp", "2 pcs": whole numbers without decimals, others to 1 dp. */
export function quantityText(quantity: number, unit: string): string {
  const shown = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 10) / 10);
  return `${shown} ${unit}`;
}

/** Still-to-buy first, then alphabetical, so the list shrinks from the top. */
export function sortGrocery(items: GroceryLine[]): GroceryLine[] {
  return [...items].sort(
    (a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name),
  );
}

export function groceryKey(line: GroceryLine): string {
  return `${line.name.toLowerCase()}|${line.unit}`;
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const TIMING_LABELS: Record<SupplementTiming, string> = {
  morning: "Morning",
  pre_workout: "Before training",
  post_workout: "After training",
  with_meal: "With a meal",
  evening: "Evening",
  bedtime: "Bedtime",
};

const TIMING_ORDER: SupplementTiming[] = ["morning", "pre_workout", "with_meal", "post_workout", "evening", "bedtime"];

export function timingRank(timing: SupplementTiming): number {
  return TIMING_ORDER.indexOf(timing);
}
