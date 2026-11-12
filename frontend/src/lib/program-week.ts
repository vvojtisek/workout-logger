const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProgramWeekProgress {
  state: "upcoming" | "active" | "ended";
  week: number;
  totalWeeks: number | null;
  elapsedPercent: number | null;
  daysUntilStart: number;
}

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

/** Measures seven-day blocks from the program start date, independent of timezone/DST. */
export function programWeekProgress(
  startDate: string,
  endDate: string | null,
  today: string,
): ProgramWeekProgress {
  const start = dayNumber(startDate);
  const current = dayNumber(today);
  const daysUntilStart = Math.max(0, start - current);
  const end = endDate === null ? null : dayNumber(endDate);
  const totalDays = end === null ? null : end - start + 1;
  const totalWeeks = totalDays === null ? null : Math.ceil(totalDays / DAYS_PER_WEEK);

  if (current < start) {
    return { state: "upcoming", week: 0, totalWeeks, elapsedPercent: 0, daysUntilStart };
  }

  const daysElapsed = current - start + 1;
  const week = Math.ceil(daysElapsed / DAYS_PER_WEEK);
  if (totalDays === null) {
    return { state: "active", week, totalWeeks: null, elapsedPercent: null, daysUntilStart: 0 };
  }
  if (end !== null && current > end) {
    return {
      state: "ended",
      week: totalWeeks ?? week,
      totalWeeks,
      elapsedPercent: 100,
      daysUntilStart: 0,
    };
  }

  return {
    state: "active",
    week: Math.min(week, totalWeeks ?? week),
    totalWeeks,
    elapsedPercent: Math.round((daysElapsed / totalDays) * 100),
    daysUntilStart: 0,
  };
}
