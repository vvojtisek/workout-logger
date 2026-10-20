import { useState } from "react";
import type { FormEvent } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { WorkoutLog } from "@/api/types";
import { FIELD_SPECS_BY_KIND } from "@/features/active-workout/SetRow";
import { addSet, draftToPatch, logToDraft, newExercise, removeSet } from "@/lib/log-edit";
import type { ExerciseDraft, SetDraft } from "@/lib/log-edit";
import { FEELING_SCALE, RIR_HINT, rirMeaning } from "@/lib/scales";
import { toast } from "@/ui/Toast";
import { Button, Card, Input } from "@/ui";
import { ScaleSelect } from "@/ui/ScaleSelect";

// The same weight and reps inputs the live workout grid uses.
const [WEIGHT_SPEC, REPS_SPEC] = FIELD_SPECS_BY_KIND.strength;
const RIR_VALUES = Array.from({ length: 11 }, (_, value) => value);

function SetEditRow({
  set,
  number,
  exerciseName,
  onChange,
  onRemove,
}: {
  set: SetDraft;
  number: number;
  exerciseName: string;
  onChange: (patch: Partial<SetDraft>) => void;
  onRemove: () => void;
}) {
  const label = `${exerciseName || "Exercise"} set ${number}`;
  return (
    <li className="grid grid-cols-[2.5rem_1fr_1fr_1.6fr_auto] items-center gap-2" data-set-row>
      <span className="text-sm text-muted" data-numeric>
        {number}
      </span>
      <Input
        aria-label={`${label} ${WEIGHT_SPEC.label}`}
        type="number"
        inputMode={WEIGHT_SPEC.inputMode}
        min={WEIGHT_SPEC.min}
        step={WEIGHT_SPEC.step}
        value={set.weight}
        onChange={(event) => onChange({ weight: event.target.value })}
        className="min-w-0 px-2"
      />
      <Input
        aria-label={`${label} ${REPS_SPEC.label}`}
        type="number"
        inputMode={REPS_SPEC.inputMode}
        min={REPS_SPEC.min}
        max={REPS_SPEC.max}
        value={set.reps}
        onChange={(event) => onChange({ reps: event.target.value })}
        className="min-w-0 px-2"
      />
      <select
        aria-label={`${label} RIR`}
        className="input min-w-0 px-2"
        value={set.rir}
        onChange={(event) => onChange({ rir: event.target.value })}
      >
        <option value="">Not rated</option>
        {RIR_VALUES.map((value) => (
          <option key={value} value={String(value)}>
            {value} · {rirMeaning(value)}
          </option>
        ))}
      </select>
      <Button variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove} className="px-2">
        &times;
      </Button>
    </li>
  );
}

function ExerciseEditCard({
  exercise,
  index,
  onChange,
  onRemove,
}: {
  exercise: ExerciseDraft;
  index: number;
  onChange: (next: ExerciseDraft) => void;
  onRemove: () => void;
}) {
  function updateSet(key: string, patch: Partial<SetDraft>) {
    onChange({
      ...exercise,
      sets: exercise.sets.map((set) => (set.key === key ? { ...set, ...patch } : set)),
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor={`edit-exercise-name-${index}`}>
            Exercise
          </label>
          <Input
            id={`edit-exercise-name-${index}`}
            value={exercise.exercise_name}
            maxLength={150}
            onChange={(event) => onChange({ ...exercise, exercise_name: event.target.value })}
          />
        </div>
        <Button variant="ghost" aria-label="Remove exercise" onClick={onRemove} className="text-danger">
          Remove
        </Button>
      </div>
      <div
        className="grid grid-cols-[2.5rem_1fr_1fr_1.6fr_auto] gap-2 text-xs font-medium text-muted"
        aria-hidden="true"
      >
        <span>Set</span>
        <span>kg</span>
        <span>Reps</span>
        <span>RIR</span>
        <span className="w-8" />
      </div>
      <ul className="flex flex-col gap-2">
        {exercise.sets.map((set, setIndex) => (
          <SetEditRow
            key={set.key}
            set={set}
            number={setIndex + 1}
            exerciseName={exercise.exercise_name}
            onChange={(patch) => updateSet(set.key, patch)}
            onRemove={() => onChange(removeSet(exercise, set.key))}
          />
        ))}
      </ul>
      <Button onClick={() => onChange(addSet(exercise))} className="self-start">
        + Add set
      </Button>
    </Card>
  );
}

export function LogEditor({
  log,
  onSaved,
  onCancel,
}: {
  log: WorkoutLog;
  onSaved: (log: WorkoutLog) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => logToDraft(log));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateExercise(key: string, next: ExerciseDraft) {
    setDraft((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => (exercise.key === key ? next : exercise)),
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = draftToPatch(draft);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await apiFetch<WorkoutLog>(`/logs/${log.id}`, {
        method: "PATCH",
        body: JSON.stringify(result.patch),
      });
      toast.success("Workout updated");
      onSaved(saved);
    } catch (err) {
      setError(`Failed to save workout: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="log-edit-form" onSubmit={submit} className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <label className="field-label" htmlFor="edit-performed-at">
            Date and time
          </label>
          <Input
            id="edit-performed-at"
            placeholder="YYYY-MM-DD HH:mm"
            value={draft.performedAt}
            onChange={(event) => setDraft({ ...draft, performedAt: event.target.value })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="edit-total-time">
            Duration (min)
          </label>
          <Input
            id="edit-total-time"
            type="number"
            inputMode="numeric"
            min="1"
            max="1440"
            value={draft.totalTime}
            onChange={(event) => setDraft({ ...draft, totalTime: event.target.value })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="edit-feeling">
            How it felt
          </label>
          <ScaleSelect
            id="edit-feeling"
            scale={FEELING_SCALE}
            value={draft.feeling}
            onChange={(feeling) => setDraft({ ...draft, feeling })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="edit-notes">
            Notes
          </label>
          <textarea
            id="edit-notes"
            className="input"
            rows={2}
            maxLength={10000}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </div>
      </Card>

      {draft.exercises.length > 0 ? <p className="text-xs text-muted">{RIR_HINT}</p> : null}
      {draft.exercises.map((exercise, index) => (
        <ExerciseEditCard
          key={exercise.key}
          exercise={exercise}
          index={index}
          onChange={(next) => updateExercise(exercise.key, next)}
          onRemove={() =>
            setDraft({
              ...draft,
              exercises: draft.exercises.filter((item) => item.key !== exercise.key),
            })
          }
        />
      ))}
      <Button
        id="edit-add-exercise"
        onClick={() => setDraft({ ...draft, exercises: [...draft.exercises, newExercise()] })}
        className="self-start"
      >
        + Add exercise
      </Button>

      {error ? (
        <p id="log-edit-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button id="save-log-btn" type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button id="cancel-edit-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
