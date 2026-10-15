import type { Scale } from "@/lib/scales";
import { scaleOptionText, scaleValues } from "@/lib/scales";

interface ScaleSelectProps {
  id: string;
  scale: Scale;
  value: string;
  onChange: (value: string) => void;
  /** Adds a "Not rated" choice that submits an empty value. */
  optional?: boolean;
  className?: string;
}

/** A picker that shows every value with its meaning, plus a one-line hint on how to read it. */
export function ScaleSelect({ id, scale, value, onChange, optional, className }: ScaleSelectProps) {
  const hintId = `${id}-hint`;
  return (
    <>
      <select
        id={id}
        className={className ?? "input"}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      >
        {optional ? <option value="">Not rated</option> : null}
        {scaleValues(scale).map((option) => (
          <option key={option} value={String(option)}>
            {scaleOptionText(scale, option)}
          </option>
        ))}
      </select>
      <p id={hintId} className="mt-1 text-xs text-muted">
        {scale.hint}
      </p>
    </>
  );
}
