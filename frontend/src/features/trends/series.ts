import { apiFetch } from "@/api/client";
import type { Paginated } from "@/api/types";

export type TrendRange = "7" | "30" | "90" | "all";
export type TrendAggregation = "sum" | "average" | "max";

export interface TrendPoint {
  date: string;
  value: number | null;
  target?: number | null;
}

interface TrendBucket extends TrendPoint {
  end: string;
  samples: number;
}

const DAY = 86_400_000;

export function addTrendDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function rangeStart(range: TrendRange, end: string): string | null {
  return range === "all" ? null : addTrendDays(end, 1 - Number(range));
}

export function readTrendDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function entryRange(path: string, from: string, to: string): string {
  return `${path}?${new URLSearchParams({ from, to })}`;
}

export async function fetchAllEntries<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  const separator = path.includes("?") ? "&" : "?";
  while (true) {
    const page = await apiFetch<Paginated<T>>(
      `${path}${separator}limit=100&offset=${items.length}`,
      { signal },
    );
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
  }
}

function bucketEnd(date: string, range: TrendRange): string {
  if (range === "7") return date;
  const start = new Date(`${date}T00:00:00Z`);
  if (range === "all") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  return addTrendDays(date, (7 - start.getUTCDay()) % 7);
}

function aggregate(values: number[], method: TrendAggregation): number | null {
  if (!values.length) return null;
  if (method === "max") return values.reduce((max, value) => Math.max(max, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  return method === "average" ? total / values.length : total;
}

export function trendBuckets(
  points: readonly TrendPoint[],
  range: TrendRange,
  end: string,
  method: TrendAggregation,
  startDate?: string,
): TrendBucket[] {
  const start = startDate ?? rangeStart(range, end) ?? points.reduce(
    (first, point) => point.date < first ? point.date : first,
    end,
  );
  const samples = new Map<string, { values: number[]; targets: number[] }>();
  for (const point of points) {
    if (point.date < start || point.date > end) continue;
    const key = bucketEnd(point.date, range);
    const bucket = samples.get(key) ?? { values: [], targets: [] };
    if (point.value !== null) bucket.values.push(point.value);
    if (point.value !== null && point.target != null) bucket.targets.push(point.target);
    samples.set(key, bucket);
  }

  const buckets: TrendBucket[] = [];
  for (let date = start; date <= end;) {
    const key = bucketEnd(date, range);
    const bucket = samples.get(key);
    const last = key < end ? key : end;
    buckets.push({
      date,
      end: last,
      value: aggregate(bucket?.values ?? [], method),
      target: aggregate(bucket?.targets ?? [], method),
      samples: bucket?.values.length ?? 0,
    });
    date = addTrendDays(last, 1);
  }
  return buckets;
}
