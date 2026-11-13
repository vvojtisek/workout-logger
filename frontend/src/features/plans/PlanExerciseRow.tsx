import type { ExerciseRowState } from "@/lib/plan-draft";
import type { ExerciseKind } from "@/lib/workout-utils";
import { Button, Input } from "@/ui";

const KIND_LABELS: Record<ExerciseKind, string> = {
  strength: "Strength",
  bodyweight: "Bodyweight",
  cardio: "Cardio",
};

/** The column template shared by the header and every row from 1024px up. */
export const PLAN_GRID =
  "lg:grid-cols-[1.75rem_minmax(10rem,1fr)_3.5rem_3.5rem_3.5rem_5rem_3.5rem_4.5rem]";

/** A visible label on the phone; a screen-reader-only one beside the table's header on desktop. */
function Field({
  htmlFor,
  label,
  error,
  className = "",
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="field-label lg:sr-only" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function PlanTableHeader() {
  const cell = "px-1 text-xs font-semibold tracking-wide text-muted uppercase";
  return (
    <div
      aria-hidden="true"
      className={`hidden gap-x-2 border-b border-line px-0 pb-2 lg:grid ${PLAN_GRID}`}
    >
      <span className={cell}>#</span>
      <span className={cell}>Exercise</span>
      <span className={cell}>Sets</span>
      <span className={cell}>Min</span>
      <span className={cell}>Max</span>
      <span className={cell}>kg</span>
      <span className={cell}>RIR</span>
      <span className={cell}>Rest s</span>
    </div>
  );
}

/**
 * One exercise. A flat block on the phone, one table row (plus a quieter
 * second line for type, superset and notes) from 1024px up. A single DOM so
 * every control keeps one accessible name at both sizes.
 */
export function PlanExerciseRow({
  row,
  index,
  count,
  superset,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  row: ExerciseRowState;
  index: number;
  count: number;
  /** Superset letter ("A", "B"…) or "" when this exercise is not grouped. */
  superset: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<ExerciseRowState>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = (part: string) => `exercise-${part}-${row.key}`;
  const err = (field: string) => errors[`${index}.${field}`];
  const label = row.exercise_name || `exercise ${index + 1}`;
  const num = "font-mono lg:px-1.5 lg:text-center";

  return (
    <div
      className={`plan-exercise-row grid grid-cols-2 gap-x-3 gap-y-3 border-b border-line-muted py-4 lg:gap-x-2 lg:gap-y-1 lg:py-2 ${PLAN_GRID}`}
    >
      <div className="col-span-2 flex items-center justify-between gap-2 lg:contents">
        <span className="flex items-center gap-2 lg:col-start-1 lg:row-start-1 lg:self-center">
          <span className="font-mono text-sm font-semibold text-muted lg:text-xs" data-numeric>
            <span className="lg:hidden">Exercise </span>
            {index + 1}
          </span>
          {superset ? (
            <span
              title="Superset"
              className="rounded-full bg-accent-soft px-2 font-mono text-xs font-semibold text-accent-ink lg:hidden"
            >
              {superset}
            </span>
          ) : null}
        </span>
        <div className="flex gap-1 lg:col-span-1 lg:col-start-8 lg:row-start-2 lg:justify-self-end">
          <Button
            aria-label={`Move ${label} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="min-w-11 px-2"
          >
            ↑
          </Button>
          <Button
            aria-label={`Move ${label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className="min-w-11 px-2"
          >
            ↓
          </Button>
          <Button
            variant="danger"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            className="lg:min-w-11 lg:bg-transparent! lg:px-2 lg:text-danger!"
          >
            <span className="lg:hidden">Remove</span>
            <span aria-hidden="true" className="hidden text-base lg:inline">
              ✕
            </span>
          </Button>
        </div>
      </div>

      <Field
        htmlFor={id("name")}
        label="Exercise name"
        error={err("exercise_name")}
        className="col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1"
      >
        <Input
          id={id("name")}
          list="exercise-catalogue-names"
          autoComplete="off"
          value={row.exercise_name}
          onChange={(e) => onChange({ exercise_name: e.target.value })}
        />
      </Field>

      <Field htmlFor={id("sets")} label="Target sets" error={err("target_sets")} className="lg:col-start-3 lg:row-start-1">
        <Input
          id={id("sets")}
          type="number"
          min="1"
          max="100"
          className={num}
          value={row.target_sets}
          onChange={(e) => onChange({ target_sets: e.target.value })}
        />
      </Field>
      <Field htmlFor={id("weight")} label="Target weight (kg)" error={err("target_weight_kg")} className="lg:col-start-6 lg:row-start-1">
        <Input
          id={id("weight")}
          type="number"
          min="0"
          step="0.5"
          className={num}
          value={row.target_weight_kg}
          onChange={(e) => onChange({ target_weight_kg: e.target.value })}
        />
      </Field>
      <Field htmlFor={id("reps-min")} label="Min reps" error={err("target_reps_min")} className="lg:col-start-4 lg:row-start-1">
        <Input
          id={id("reps-min")}
          type="number"
          min="1"
          max="1000"
          className={num}
          value={row.target_reps_min}
          onChange={(e) => onChange({ target_reps_min: e.target.value })}
        />
      </Field>
      <Field htmlFor={id("reps-max")} label="Max reps" error={err("target_reps_max")} className="lg:col-start-5 lg:row-start-1">
        <Input
          id={id("reps-max")}
          type="number"
          min="1"
          max="1000"
          className={num}
          value={row.target_reps_max}
          onChange={(e) => onChange({ target_reps_max: e.target.value })}
        />
      </Field>
      {row.exercise_kind === "strength" ? (
        <Field htmlFor={id("rir")} label="Target RIR (optional)" error={err("target_rir")} className="lg:col-start-7 lg:row-start-1">
          <Input
            id={id("rir")}
            type="number"
            min="0"
            max="10"
            placeholder="–"
            className={num}
            value={row.target_rir}
            onChange={(e) => onChange({ target_rir: e.target.value })}
          />
        </Field>
      ) : (
        <div aria-hidden="true" className="hidden lg:col-start-7 lg:row-start-1 lg:block" />
      )}
      <Field htmlFor={id("rest")} label="Rest seconds" error={err("rest_time_seconds")} className="lg:col-start-8 lg:row-start-1">
        <Input
          id={id("rest")}
          type="number"
          min="0"
          max="3600"
          className={num}
          value={row.rest_time_seconds}
          onChange={(e) => onChange({ rest_time_seconds: e.target.value })}
        />
      </Field>
      <Field htmlFor={id("kind")} label="Exercise type" className="col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-2">
        <select
          id={id("kind")}
          className="input"
          value={row.exercise_kind}
          onChange={(e) => onChange({ exercise_kind: e.target.value as ExerciseKind })}
        >
          {(Object.keys(KIND_LABELS) as ExerciseKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>
      <Field htmlFor={id("group")} label="Superset group" error={err("group_key")} className="col-span-2 lg:col-span-2 lg:col-start-3 lg:row-start-2">
        <Input
          id={id("group")}
          placeholder="Group"
          value={row.group_key}
          onChange={(e) => onChange({ group_key: e.target.value })}
        />
      </Field>
      <Field htmlFor={id("notes")} label="Notes" className="col-span-2 lg:col-span-3 lg:col-start-5 lg:row-start-2">
        <Input
          id={id("notes")}
          placeholder="Notes"
          value={row.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}
