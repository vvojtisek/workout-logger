import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

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

const ROW_GRID =
  "grid grid-cols-[3rem_5rem_repeat(3,minmax(4rem,1fr))_minmax(7rem,auto)] gap-2 min-w-[38rem]";

function numericValue(raw: string): number | null {
  return raw ? Number.parseFloat(raw) : null;
}

/**
 * A single numeric cell.
 *
 * The input is deliberately UNCONTROLLED. A set grid is filled in rapidly, often
 * while the session object is being replaced by a server response, and a
 * controlled value re-rendered mid-edit can drop or misplace a keystroke. The
 * DOM is therefore the source of truth for an unsaved row: the draft is written
 * from it on input and it is read back on submit, which is exactly how the
 * pre-React implementation behaved. Remounting via `key` re-seeds it when the
 * row crosses the saved/unsaved boundary.
 *
 * The input is nested inside its label so the screen-reader-only label text is
 * also its accessible name; the column header row carries the visible one.
 */
function NumberCell({
  label,
  inputRef,
  defaultValue,
  onInput,
  inputMode,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
  defaultValue: string;
  onInput: () => void;
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
        ref={inputRef}
        type="number"
        inputMode={inputMode}
        min={min}
        max={max ?? ""}
        step={step ?? "1"}
        defaultValue={defaultValue}
        disabled={disabled}
        onInput={onInput}
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

  const weightRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const rirRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);

  const entryId = row.entry?.id ?? null;
  const draft = row.entry ? null : loadSetDraft(localStorage, draftKey);
  const seed = {
    weight: draft?.weight ?? (display.weightKg ?? "").toString(),
    reps: draft?.reps ?? (display.reps ?? "").toString(),
    rir: draft?.rir ?? (display.rir ?? "").toString(),
  };

  // Crossing the saved/unsaved boundary is the only thing that replaces what is
  // typed in the row, so it also ends any in-progress correction.
  useEffect(() => {
    setEditing(false);
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

  function saveDraft() {
    if (row.entry) return;
    saveSetDraft(localStorage, draftKey, {
      weight: weightRef.current?.value ?? "",
      reps: repsRef.current?.value ?? "",
      rir: rirRef.current?.value ?? "",
    });
  }

  function currentValues(): SetValues {
    const rir = rirRef.current?.value ?? "";
    return {
      weight: numericValue(weightRef.current?.value ?? ""),
      reps: Number.parseInt(repsRef.current?.value ?? "", 10),
      rir: rir ? Number.parseInt(rir, 10) : null,
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
  // Remounts the inputs, re-reading defaultValue, only when the row is saved,
  // corrected, or undone - never while it is being filled in.
  const seedKey = entryId ?? "draft";

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
        key={`weight:${seedKey}`}
        label="Weight (kg)"
        inputRef={weightRef}
        defaultValue={seed.weight}
        onInput={saveDraft}
        inputMode="decimal"
        min="0"
        step="0.25"
        disabled={disabled}
      />
      <NumberCell
        key={`reps:${seedKey}`}
        label="Repetitions"
        inputRef={repsRef}
        defaultValue={seed.reps}
        onInput={saveDraft}
        inputMode="numeric"
        min="1"
        max="1000"
        disabled={disabled}
      />
      <NumberCell
        key={`rir:${seedKey}`}
        label="RIR"
        inputRef={rirRef}
        defaultValue={seed.rir}
        onInput={saveDraft}
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
