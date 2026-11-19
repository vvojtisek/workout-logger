import { useState } from "react";

interface MeasurementControlProps {
  name: string;
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  error?: string;
  included?: boolean;
  onInclude?: (included: boolean) => void;
}

export function MeasurementControl({
  name,
  label,
  value,
  min,
  max,
  onChange,
  error,
  included,
  onInclude,
}: MeasurementControlProps) {
  // Hold the fine-adjustment window still while a thumb is moving. With no
  // starting value the first drag can pick anywhere in the measurement range.
  const [anchor, setAnchor] = useState<number | null>(() => (value === "" ? null : Number(value)));
  const numeric = value === "" ? null : Number(value);
  function center(next: number | null) {
    setAnchor(next === null ? null : Math.max(min, Math.min(max, next)));
  }
  function nudge(direction: number) {
    const next = Math.max(
      min,
      Math.min(max, Math.round(((numeric ?? 0) + direction * 0.1) * 10) / 10),
    );
    onChange(String(next));
    center(next);
  }
  const low = anchor === null ? min : Math.max(min, Math.floor(anchor) - 2);
  const high = anchor === null ? max : Math.min(max, Math.ceil(anchor) + 2);
  const id = `metric-${name}`;
  const title = label.split(" (")[0];
  const buttonClass = "h-11 w-11 shrink-0 text-xl text-accent disabled:opacity-40";

  return (
    <div className="min-w-0">
      <div className="flex min-h-9 items-center justify-between gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {onInclude && (
          <label className="flex min-h-9 min-w-9 items-center justify-center">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              aria-label={`Include ${title}`}
              disabled={value === ""}
              checked={included}
              onChange={(event) => onInclude(event.target.checked)}
            />
          </label>
        )}
      </div>
      <div className="flex items-center rounded-md border border-line bg-elevated">
        <button
          type="button"
          className={buttonClass}
          aria-label={`Decrease ${title}`}
          disabled={numeric === null || numeric <= min}
          onClick={() => nudge(-1)}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          max={max}
          value={value}
          placeholder="—"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => center(numeric)}
          className="h-11 w-full min-w-0 bg-transparent text-center font-mono text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          className={buttonClass}
          aria-label={`Increase ${title}`}
          disabled={numeric !== null && numeric >= max}
          onClick={() => nudge(1)}
        >
          +
        </button>
      </div>
      <input
        type="range"
        min={low}
        max={high}
        step="0.1"
        value={numeric ?? low}
        aria-label={`Adjust ${title}`}
        aria-valuetext={value || "No measurement"}
        className="block h-8 w-full cursor-pointer accent-accent"
        onChange={(event) => onChange(event.target.value)}
        onPointerUp={(event) => center(event.currentTarget.valueAsNumber)}
        onBlur={() => center(numeric)}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
