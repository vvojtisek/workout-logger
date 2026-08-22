import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, WorkoutPlan } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { parseRepsPerSet } from "@/lib/workout-utils";
import { toast } from "@/ui/Toast";
import { Button, Card, Input, PageHeading } from "@/ui";

interface ExerciseRow {
  key: string;
  exercise_name: string;
  sets: string;
  reps: string;
  weight: string;
  rest: string;
}

function emptyRow(): ExerciseRow {
  return { key: crypto.randomUUID(), exercise_name: "", sets: "", reps: "", weight: "", rest: "" };
}

export function NewLogView() {
  const { online } = useAppContext();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [performedAt, setPerformedAt] = useState("");
  const [totalTime, setTotalTime] = useState("");
  const [calories, setCalories] = useState("");
  const [feeling, setFeeling] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ExerciseRow[]>([]);

  useEffect(() => {
    apiFetch<Paginated<WorkoutPlan>>("/plans?limit=100")
      .then((data) => setPlans(data.items))
      .catch(() => undefined);
  }, []);

  async function selectPlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    setRows([]);
    if (!nextPlanId) return;
    try {
      const plan = await apiFetch<WorkoutPlan>(`/plans/${nextPlanId}`);
      setRows(
        plan.exercises.map((exercise) => ({
          key: crypto.randomUUID(),
          exercise_name: exercise.exercise_name || "",
          sets: exercise.target_sets ? String(exercise.target_sets) : "",
          reps: "",
          weight: exercise.target_weight_kg ? String(exercise.target_weight_kg) : "",
          rest: exercise.rest_time_seconds ? String(exercise.rest_time_seconds) : "",
        })),
      );
    } catch {
      // leave exercise list empty on failure
    }
  }

  function updateRow(key: string, patch: Partial<ExerciseRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!performedAt) return;

    const exercises = rows.map((row) => ({
      exercise_name: row.exercise_name,
      sets_count: Number.parseInt(row.sets, 10),
      reps_per_set: parseRepsPerSet(row.reps),
      weight_kg: row.weight ? Number.parseFloat(row.weight) : null,
      rest_time_seconds: row.rest ? Number.parseInt(row.rest, 10) : 60,
    }));

    const payload = {
      source_plan_id: planId || null,
      performed_at: new Date(performedAt).toISOString(),
      total_time_minutes: Number.parseInt(totalTime, 10),
      calories_burned: calories ? Number.parseInt(calories, 10) : null,
      overall_feeling: Number.parseInt(feeling, 10),
      notes: notes || null,
      exercises,
    };

    try {
      await apiFetch("/logs", { method: "POST", body: JSON.stringify(payload) });
      toast.success("Workout saved");
      void navigate("/history");
    } catch (err) {
      toast.error(`Failed to save workout: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="new-log-view">
      <PageHeading hint="Record a workout you already finished.">New Workout</PageHeading>
      <form id="new-log-form" onSubmit={submit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <label className="field-label" htmlFor="log-plan-select">
              Use plan as template
            </label>
            <select
              id="log-plan-select"
              className="input"
              value={planId}
              onChange={(event) => void selectPlan(event.target.value)}
            >
              <option value="">None</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="log-performed-at">
                Performed at
              </label>
              <Input
                id="log-performed-at"
                type="datetime-local"
                required
                value={performedAt}
                onChange={(event) => setPerformedAt(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="log-total-time">
                Total time (minutes)
              </label>
              <Input
                id="log-total-time"
                type="number"
                min="1"
                max="1440"
                required
                value={totalTime}
                onChange={(event) => setTotalTime(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="log-calories">
                Calories burned
              </label>
              <Input
                id="log-calories"
                type="number"
                min="0"
                value={calories}
                onChange={(event) => setCalories(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="log-feeling">
                Overall feeling (1-5)
              </label>
              <Input
                id="log-feeling"
                type="number"
                min="1"
                max="5"
                required
                value={feeling}
                onChange={(event) => setFeeling(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="log-notes">
              Notes
            </label>
            <textarea
              id="log-notes"
              className="input"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </Card>

        <div>
          <h3 className="mb-2 font-medium">Exercises</h3>
          <div id="log-exercises-list" className="flex flex-col gap-3">
            {rows.map((row) => (
              <div key={row.key} className="exercise-row card flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Exercise</span>
                  <Button
                    variant="danger"
                    className="remove-exercise-btn"
                    onClick={() =>
                      setRows((current) => current.filter((item) => item.key !== row.key))
                    }
                  >
                    Remove
                  </Button>
                </div>
                <Input
                  className="exercise-name"
                  placeholder="Exercise name"
                  required
                  value={row.exercise_name}
                  onChange={(event) => updateRow(row.key, { exercise_name: event.target.value })}
                />
                <Input
                  className="exercise-sets"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="Sets count"
                  required
                  value={row.sets}
                  onChange={(event) => updateRow(row.key, { sets: event.target.value })}
                />
                <Input
                  className="exercise-reps"
                  placeholder="Reps per set, comma separated (e.g. 10,10,8)"
                  required
                  value={row.reps}
                  onChange={(event) => updateRow(row.key, { reps: event.target.value })}
                />
                <Input
                  className="exercise-weight"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Weight (kg)"
                  value={row.weight}
                  onChange={(event) => updateRow(row.key, { weight: event.target.value })}
                />
                <Input
                  className="exercise-rest"
                  type="number"
                  min="0"
                  max="3600"
                  placeholder="Rest seconds"
                  value={row.rest}
                  onChange={(event) => updateRow(row.key, { rest: event.target.value })}
                />
              </div>
            ))}
          </div>
          <Button
            id="add-exercise-btn"
            className="mt-3"
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            + Add exercise
          </Button>
        </div>

        <Button
          id="submit-log-btn"
          type="submit"
          variant="primary"
          disabled={!online}
          className="self-start"
        >
          Save workout
        </Button>
      </form>
    </section>
  );
}
