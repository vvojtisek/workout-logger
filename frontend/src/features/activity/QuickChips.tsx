import { useId } from "react";
import type { ReactNode } from "react";

export interface ChipOption<V extends string | number> {
  value: V;
  label: string;
  /** Marks the value the prefill predicted. */
  predicted?: boolean;
}

/** A row of single-choice chips, each a 44px-tall toggle button. With
 * `clearable`, tapping the chosen chip again clears the choice. */
export function ChipGroup<V extends string | number>({
  label,
  options,
  value,
  onChange,
  clearable = false,
  testId,
  hint,
  children,
}: {
  label: string;
  options: ChipOption<V>[];
  value: V | null;
  onChange: (value: V | null) => void;
  clearable?: boolean;
  testId?: string;
  hint?: string;
  children?: ReactNode;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} data-testid={testId} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-sm font-semibold">
          {label}
        </span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={selected}
              data-predicted={option.predicted ? "true" : undefined}
              onClick={() => onChange(selected && clearable ? null : option.value)}
              className={`min-h-11 min-w-11 rounded-full border px-3 py-1.5 text-sm ${
                selected
                  ? "border-accent bg-accent-soft font-semibold text-main"
                  : "border-line bg-elevated text-main"
              }`}
            >
              {option.label}
            </button>
          );
        })}
        {children}
      </div>
    </div>
  );
}

/** Minus / value / plus for small counts such as sauna cycles. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit: string;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex items-center justify-between gap-3">
      <span id={labelId} className="text-sm font-semibold">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Fewer ${unit}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="min-h-11 min-w-11 rounded-full border border-line bg-elevated text-lg disabled:opacity-40"
        >
          −
        </button>
        <output data-numeric aria-live="polite" className="min-w-16 text-center text-base font-semibold">
          {value} {unit}
        </output>
        <button
          type="button"
          aria-label={`More ${unit}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="min-h-11 min-w-11 rounded-full border border-line bg-elevated text-lg disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
