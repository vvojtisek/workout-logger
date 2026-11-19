import { useId } from "react";
import { Input } from "@/ui";
import { ClockInput } from "./ClockInput";

interface Props {
  legend?: string;
  labelPrefix?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function DateTimeFields({ legend, labelPrefix = legend, value, onChange, error }: Props) {
  const id = useId();
  // Keep partial fields independent while either half is being edited.
  const split = value.indexOf(" ");
  const date = split < 0 ? value : value.slice(0, split);
  const time = split < 0 ? "" : value.slice(split + 1);
  const dateLabel = labelPrefix ? `${labelPrefix} date` : "Date";
  const timeLabel = labelPrefix ? `${labelPrefix} time` : "Time";
  const hint = error ? `${id}-error` : undefined;
  return (
    <fieldset className="min-w-0">
      {legend && <legend className="field-label">{legend}</legend>}
      <div className="grid grid-cols-2 items-end gap-2">
        <div className="min-w-0">
          {!legend && (
            <label className="field-label" htmlFor={`${id}-date`}>
              Date
            </label>
          )}
          <Input
            id={`${id}-date`}
            type="date"
            aria-label={dateLabel}
            required
            value={date}
            className="min-w-0 text-base"
            aria-invalid={!!error}
            aria-describedby={hint}
            onChange={(e) => onChange(`${e.target.value} ${time}`)}
          />
        </div>
        <div className="min-w-0">
          {!legend && (
            <label className="field-label" htmlFor={`${id}-time`}>
              Time
            </label>
          )}
          <ClockInput
            id={`${id}-time`}
            label={timeLabel}
            required
            value={time}
            invalid={!!error}
            describedBy={hint}
            onChange={(clock) => onChange(`${date} ${clock}`)}
          />
        </div>
      </div>
      {error && (
        <p id={hint} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
