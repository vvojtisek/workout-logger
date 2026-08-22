import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  clearSetDraft,
  draftStorageKey,
  loadSetDraft,
  saveSetDraft,
} from "@/lib/active-workout-state";
import { resolveSetDisplayState } from "@/lib/workout-utils";
import type { GridRow } from "@/lib/workout-utils";

const UNDO_WINDOW_MS = 5_000;

export interface SetValues {
  weight: number | null;
  reps: number;
  rir: number | null;
}

interface DraftValues {
  weight: string;
  reps: string;
  rir: string;
}

const ROW_GRID =
  "grid grid-cols-[3rem_5rem_repeat(3,minmax(4rem,1fr))_minmax(7rem,auto)] gap-2 min-w-[38rem]";

function numericValue(raw: string): number | null {
  return raw ? Number.parseFloat(raw) : null;
}

/** A single numeric cell. The input is nested inside its label so the visible
 *  text is also the accessible name assistive tech and tests resolve. */
function NumberCell({
  label,
  value,
  onChange,
  inputMode,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  inputMode: "decimal" | "numeric";
  min: string;
  max?: string;
  step?: string;
  disabled: boolean;
}) {
  return (
    <label className="text-xs font-medium text-muted">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        inputMode={inputMode}
        min={min}
        max={max ?? ""}
        step={step ?? "1"}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input block w-20 min-h-touch min-w-touch px-2"
      />
    </label>
  );
}

export function SetRow({
  row,
  sessionId,
  totalSets,
  onComplete,
  onSkip,
  onCorrect,
  onUndo,
  onFocusSet,
}: {
  row: GridRow;
  sessionId: string;
  totalSets: number;
  onComplete: (row: GridRow, values: SetValues) => void;
  onSkip: (row: GridRow, values: SetValues) => void;
  onCorrect: (row: GridRow, values: SetValues) => void;
  onUndo: (row: GridRow) => void;
  onFocusSet: (row: GridRow) => void;
}) {
  const draftKey = draftStorageKey(sessionId, row.exercise.id, row.setNumber);
  const display = resolveSetDisplayState({
    savedEntry: row.entry,
    suggestedWeightKg: row.exercise.suggested_weight_kg,
    suggestedReps: row.exercise.suggested_reps,
    suggestionSource: row.exercise.suggestion_source,
  });

  const [values, setValues] = useState<DraftValues>(() => initialValues());
  const [editing, setEditing] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  function initialValues(): DraftValues {
    const draft = row.entry ? null : loadSetDraft(localStorage, draftKey);
    return {
      weight: draft?.weight ?? (display.weightKg ?? "").toString(),
      reps: draft?.reps ?? (display.reps ?? "").toString(),
      rir: draft?.rir ?? (display.rir ?? "").toString(),
    };
  }

  // Re-seed the inputs only when the row crosses the saved/unsaved boundary, so
  // typing survives every unrelated re-render of the session.
  const entryId = row.entry?.id ?? null;
  useEffect(() => {
    setValues(initialValues());
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  // A persisted set is authoritative; its local draft is no longer meaningful.
  useEffect(() => {
    if (row.entry) clearSetDraft(localStorage, draftKey);
  }, [row.entry, draftKey]);

  // The five-second undo window is measured from the server's completion time.
  useEffect(() => {
    if (!row.entry?.completed_at) {
      setUndoVisible(false);
      return;
    }
    const remaining = UNDO_WINDOW_MS - (Date.now() - new Date(row.entry.completed_at).getTime());
    if (remaining <= 0) {
      setUndoVisible(false);
      return;
    }
    setUndoVisible(true);
    const handle = window.setTimeout(() => setUndoVisible(false), remaining);
    return () => window.clearTimeout(handle);
  }, [row.entry?.completed_at, row.entry?.id]);

  function update(patch: Partial<DraftValues>) {
    const next = { ...values, ...patch };
    setValues(next);
    if (!row.entry) saveSetDraft(localStorage, draftKey, next);
  }

  function currentValues(): SetValues {
    return {
      weight: numericValue(values.weight),
      reps: Number.parseInt(values.reps, 10),
      rir: values.rir ? Number.parseInt(values.rir, 10) : null,
    };
  }

  const disabled = row.entry !== null && !editing;
  const stateClass =
    row.state === "completed"
      ? "bg-success-soft"
      : row.state === "skipped"
        ? "bg-warn-soft"
        : row.state === "current"
          ? "ring-2 ring-accent"
          : "opacity-70";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (row.entry) return;
    onComplete(row, currentValues());
  }

  const exerciseName = row.exercise.exercise_name;

  return (
    <form
      data-set-row=""
      data-exercise-name={exerciseName}
      data-set-number={String(row.setNumber)}
      data-state={row.state}
      onSubmit={submit}
      className={`${ROW_GRID} items-end border-t border-border-subtle py-2 ${stateClass}`}
    >
      <strong className="self-center" data-numeric>
        {row.setNumber}
      </strong>
      <span className="self-center text-xs text-muted" data-numeric>
        {row.exercise.suggested_weight_kg ?? "—"} kg × {row.exercise.suggested_reps}
      </span>
      <NumberCell
        label="Weight (kg)"
        value={values.weight}
        onChange={(next) => update({ weight: next })}
        inputMode="decimal"
        min="0"
        step="0.25"
        disabled={disabled}
      />
      <NumberCell
        label="Repetitions"
        value={values.reps}
        onChange={(next) => update({ reps: next })}
        inputMode="numeric"
        min="1"
        max="1000"
        disabled={disabled}
      />
      <NumberCell
        label="RIR"
        value={values.rir}
        onChange={(next) => update({ rir: next })}
        inputMode="numeric"
        min="0"
        max="10"
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-1">
        {row.entry ? (
          <>
            <span
              className={`self-center text-xs font-medium ${
                row.state === "skipped" ? "text-warn" : "text-success"
              }`}
            >
              {row.state === "skipped" ? "Skipped" : "Saved"}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-touch"
              onClick={() => {
                if (!editing) {
                  setEditing(true);
                  return;
                }
                onCorrect(row, currentValues());
              }}
            >
              {editing ? "Save correction" : "Edit"}
            </button>
            {undoVisible ? (
              <button
                type="button"
                className="btn btn-secondary btn-touch"
                onClick={() => onUndo(row)}
              >
                Undo
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="self-center text-xs text-warn">{display.label}</span>
            <button type="submit" className="btn btn-primary btn-touch">
              {totalSets === 1 ? "Save set" : `Complete ${exerciseName} set ${row.setNumber}`}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-touch"
              onClick={() => onSkip(row, currentValues())}
            >
              {`Skip ${exerciseName} set ${row.setNumber}`}
            </button>
            {row.state !== "current" ? (
              <button
                type="button"
                className="btn btn-secondary btn-touch"
                onClick={() => onFocusSet(row)}
              >
                {`Open ${exerciseName} set ${row.setNumber}`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </form>
  );
}
