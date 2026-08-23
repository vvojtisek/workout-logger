import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import {
  clearSetDraft,
  draftStorageKey,
  loadSetDraft,
  saveSetDraft,
} from "@/lib/active-workout-state";
import type { SetDraft } from "@/lib/active-workout-state";
import { resolveSetDisplayState } from "@/lib/workout-utils";
import type { ExerciseKind, GridRow } from "@/lib/workout-utils";

const UNDO_WINDOW_MS = 5_000;

export interface SetValues {
  weight: number | null;
  reps: number;
  rir: number | null;
  added_weight_kg: number | null;
  band_level: string | null;
  duration_seconds: number | null;
  distance_km: number | null;
  incline_percent: number | null;
}

const EMPTY_DRAFT: SetDraft = {
  weight: "",
  reps: "",
  rir: "",
  added_weight_kg: "",
  band_level: "",
  duration_seconds: "",
  distance_km: "",
  incline_percent: "",
};

// Fixed widths, shared verbatim with ActiveWorkoutView's column-header row: each
// set row is its own independent grid container, so if any column here were
// flexible (1fr/auto) its track width would depend on that row's own content -
// for example a longer exercise name growing the action column - and rows would
// stop lining up with the header and with each other.
export const ROW_GRID = "grid grid-cols-[3.5rem_6rem_5.5rem_5.5rem_5.5rem_12rem] gap-2 min-w-[38rem]";

/** The three input cells shown for each exercise kind, in column order. Every
 *  kind gets exactly three, matching the grid's three middle columns. */
interface FieldSpec {
  draftKey: keyof SetDraft;
  label: string;
  type: "number" | "text";
  inputMode?: "decimal" | "numeric";
  min?: string;
  max?: string;
  step?: string;
}

export const COLUMN_HEADERS_BY_KIND: Record<ExerciseKind, string[]> = {
  strength: ["Set", "Previous", "kg", "Reps", "RIR", "Complete"],
  bodyweight: ["Set", "Previous", "Added kg", "Reps", "Band", "Complete"],
  cardio: ["Set", "Previous", "Duration (s)", "Distance (km)", "Incline (%)", "Complete"],
};

const FIELD_SPECS_BY_KIND: Record<ExerciseKind, FieldSpec[]> = {
  strength: [
    { draftKey: "weight", label: "Weight (kg)", type: "number", inputMode: "decimal", min: "0", step: "0.25" },
    { draftKey: "reps", label: "Repetitions", type: "number", inputMode: "numeric", min: "1", max: "1000" },
    { draftKey: "rir", label: "RIR", type: "number", inputMode: "numeric", min: "0", max: "10" },
  ],
  bodyweight: [
    {
      draftKey: "added_weight_kg",
      label: "Added weight (kg)",
      type: "number",
      inputMode: "decimal",
      min: "0",
      step: "0.25",
    },
    { draftKey: "reps", label: "Repetitions", type: "number", inputMode: "numeric", min: "1", max: "1000" },
    { draftKey: "band_level", label: "Band level", type: "text" },
  ],
  cardio: [
    {
      draftKey: "duration_seconds",
      label: "Duration (seconds)",
      type: "number",
      inputMode: "numeric",
      min: "0",
      max: "86400",
    },
    {
      draftKey: "distance_km",
      label: "Distance (km)",
      type: "number",
      inputMode: "decimal",
      min: "0",
      step: "0.01",
    },
    {
      draftKey: "incline_percent",
      label: "Incline (%)",
      type: "number",
      inputMode: "decimal",
      min: "-100",
      max: "100",
      step: "0.5",
    },
  ],
};

function numericValue(raw: string): number | null {
  return raw ? Number.parseFloat(raw) : null;
}

/**
 * A single input cell, numeric or text. Deliberately UNCONTROLLED. A set grid
 * is filled in rapidly, often while the session object is being replaced by a
 * server response, and a controlled value re-rendered mid-edit can drop or
 * misplace a keystroke. The DOM is therefore the source of truth for an
 * unsaved row: the draft is written from it on input and it is read back on
 * submit, which is exactly how the pre-React implementation behaved.
 * Remounting via `key` re-seeds it when the row crosses the saved/unsaved
 * boundary.
 *
 * The input is nested inside its label so the screen-reader-only label text is
 * also its accessible name; the column header row carries the visible one.
 */
function FieldCell({
  spec,
  inputRef,
  defaultValue,
  onInput,
  disabled,
}: {
  spec: FieldSpec;
  inputRef: RefObject<HTMLInputElement | null>;
  defaultValue: string;
  onInput: () => void;
  disabled: boolean;
}) {
  return (
    <label className="text-xs font-medium text-muted">
      <span className="sr-only">{spec.label}</span>
      <input
        ref={inputRef}
        type={spec.type === "number" ? "number" : "text"}
        inputMode={spec.type === "number" ? spec.inputMode : undefined}
        min={spec.type === "number" ? spec.min : undefined}
        max={spec.type === "number" ? spec.max : undefined}
        step={spec.type === "number" ? (spec.step ?? "1") : undefined}
        maxLength={spec.type === "text" ? 20 : undefined}
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
  roundLabel,
  onComplete,
  onSkip,
  onCorrect,
  onUndo,
  onFocusSet,
}: {
  row: GridRow;
  sessionId: string;
  totalSets: number;
  /** Compact "1A"/"1B" style label shown instead of the plain set number when
   *  this row is part of an interleaved superset round. */
  roundLabel?: string | null;
  onComplete: (row: GridRow, values: SetValues) => void;
  onSkip: (row: GridRow, values: SetValues) => void;
  onCorrect: (row: GridRow, values: SetValues) => void;
  onUndo: (row: GridRow) => void;
  onFocusSet: (row: GridRow) => void;
}) {
  const kind = row.exercise.exercise_kind;
  const fieldSpecs = FIELD_SPECS_BY_KIND[kind];
  const draftKey = draftStorageKey(sessionId, row.exercise.id, row.setNumber);
  const display = resolveSetDisplayState({
    savedEntry: row.entry,
    suggestedWeightKg: row.exercise.suggested_weight_kg,
    suggestedReps: row.exercise.suggested_reps,
    suggestionSource: row.exercise.suggestion_source,
  });

  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const fieldRefs = [ref1, ref2, ref3];
  const [editing, setEditing] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);

  const entryId = row.entry?.id ?? null;
  const savedDraft: SetDraft = draft ?? EMPTY_DRAFT;

  // IndexedDB is async, so the draft can't be read inline like the old
  // localStorage version; load it once per row and re-key the inputs (via
  // seedKey below) once it resolves so defaultValue picks it up.
  useEffect(() => {
    if (row.entry) {
      setDraft(null);
      setDraftReady(true);
      return;
    }
    let cancelled = false;
    setDraftReady(false);
    void loadSetDraft(activeWorkoutStorage, draftKey).then((loaded) => {
      if (cancelled) return;
      setDraft(loaded);
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [row.entry, draftKey]);

  function seedFor(spec: FieldSpec): string {
    if (draft) return draft[spec.draftKey];
    switch (spec.draftKey) {
      case "weight":
        return (display.weightKg ?? "").toString();
      case "reps":
        return (display.reps ?? "").toString();
      case "rir":
        return (display.rir ?? "").toString();
      case "added_weight_kg":
        return (row.entry?.added_weight_kg ?? "").toString();
      case "band_level":
        return row.entry?.band_level ?? "";
      case "duration_seconds":
        return (row.entry?.duration_seconds ?? "").toString();
      case "distance_km":
        return (row.entry?.distance_km ?? "").toString();
      case "incline_percent":
        return (row.entry?.incline_percent ?? "").toString();
    }
  }

  // Crossing the saved/unsaved boundary is the only thing that replaces what is
  // typed in the row, so it also ends any in-progress correction.
  useEffect(() => {
    setEditing(false);
  }, [entryId]);

  // A persisted set is authoritative; its local draft is no longer meaningful.
  useEffect(() => {
    if (row.entry) void clearSetDraft(activeWorkoutStorage, draftKey);
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
    const next = { ...savedDraft };
    fieldSpecs.forEach((spec, index) => {
      next[spec.draftKey] = fieldRefs[index].current?.value ?? "";
    });
    void saveSetDraft(activeWorkoutStorage, draftKey, next);
  }

  function currentValues(): SetValues {
    const raw: Record<string, string> = {};
    fieldSpecs.forEach((spec, index) => {
      raw[spec.draftKey] = fieldRefs[index].current?.value ?? "";
    });
    const rir = raw.rir ?? "";
    return {
      weight: kind === "strength" ? numericValue(raw.weight ?? "") : null,
      // A cardio set has no meaningful rep count; the field stays required
      // server-side, so it is sent as a fixed placeholder rather than shown.
      reps: kind === "cardio" ? 1 : Number.parseInt(raw.reps ?? "", 10),
      rir: kind === "strength" && rir ? Number.parseInt(rir, 10) : null,
      added_weight_kg: kind === "bodyweight" ? numericValue(raw.added_weight_kg ?? "") : null,
      band_level: kind === "bodyweight" ? raw.band_level || null : null,
      duration_seconds:
        kind === "cardio" && raw.duration_seconds
          ? Number.parseInt(raw.duration_seconds, 10)
          : null,
      distance_km: kind === "cardio" ? numericValue(raw.distance_km ?? "") : null,
      incline_percent: kind === "cardio" ? numericValue(raw.incline_percent ?? "") : null,
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
  // corrected, or undone - never on account of the async draft load. The
  // fields themselves aren't rendered at all until that load resolves (see
  // below), so there is no window in which a real input exists to type into
  // before its seed value is settled, and thus nothing for the load to race.
  const seedKey = entryId ?? "draft";
  // Until the IndexedDB draft load resolves, a saved row has nothing to wait
  // for (row.entry is authoritative), but an unsaved one must not expose an
  // input yet - typing into one now would be silently discarded the moment
  // the load resolves and (previously) remounted it. Playwright's
  // auto-waiting getByLabel simply waits for the real input to appear.
  const fieldsReady = row.entry !== null || draftReady;

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
        {roundLabel ?? row.setNumber}
      </strong>
      <span className="self-center text-xs text-muted" data-numeric>
        {kind === "cardio" ? "—" : `${row.exercise.suggested_weight_kg ?? "—"} kg × ${row.exercise.suggested_reps}`}
      </span>
      {fieldsReady
        ? fieldSpecs.map((spec, index) => (
            <FieldCell
              key={`${spec.draftKey}:${seedKey}`}
              spec={spec}
              inputRef={fieldRefs[index]}
              defaultValue={seedFor(spec)}
              onInput={saveDraft}
              disabled={disabled}
            />
          ))
        : fieldSpecs.map((spec) => (
            <span
              key={`${spec.draftKey}:pending`}
              aria-hidden="true"
              className="input block w-20 min-h-touch min-w-touch px-2 opacity-40"
            />
          ))}
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
            <button
              type="submit"
              className="btn btn-primary btn-touch"
              aria-label={
                totalSets === 1 ? undefined : `Complete ${exerciseName} set ${row.setNumber}`
              }
            >
              {totalSets === 1 ? "Save set" : "Complete"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-touch"
              aria-label={`Skip ${exerciseName} set ${row.setNumber}`}
              onClick={() => onSkip(row, currentValues())}
            >
              Skip
            </button>
            {row.state !== "current" ? (
              <button
                type="button"
                className="btn btn-secondary btn-touch"
                aria-label={`Open ${exerciseName} set ${row.setNumber}`}
                onClick={() => onFocusSet(row)}
              >
                Open
              </button>
            ) : null}
          </>
        )}
      </div>
    </form>
  );
}
