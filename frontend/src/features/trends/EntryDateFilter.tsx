import { Link, useSearchParams } from "react-router-dom";

import { readTrendDate } from "./series";

export function useEntryDates() {
  const [params, setParams] = useSearchParams();
  const from = readTrendDate(params.get("from"));
  const to = readTrendDate(params.get("to"));
  const dates = new URLSearchParams();
  if (from) dates.set("from", from);
  if (to) dates.set("to", to);
  const suffix = dates.size ? `?${dates}` : "";
  function setDate(key: "from" | "to", value: string) {
    const next = new URLSearchParams(dates);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return { from, to, dates, suffix, setDate };
}

export function EntryDateFilter({ clearTo }: { clearTo: string }) {
  const { from, to, setDate } = useEntryDates();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        From date
        <input className="input min-h-11 w-auto" type="date" max={to ?? undefined} value={from ?? ""} onChange={(event) => setDate("from", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        To date
        <input className="input min-h-11 w-auto" type="date" min={from ?? undefined} value={to ?? ""} onChange={(event) => setDate("to", event.target.value)} />
      </label>
      {from || to ? <Link className="inline-flex min-h-11 items-center text-sm text-accent-ink underline" to={clearTo}>Clear dates</Link> : null}
    </div>
  );
}
