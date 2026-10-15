import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { CatalogExercise, Paginated } from "@/api/types";
import { exerciseListPath } from "@/lib/exercise-catalogue";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, Input, PageHeading } from "@/ui";

export function ExercisesView() {
  const navigate = useNavigate();
  const [exercises, setExercises] = useState<CatalogExercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<CatalogExercise | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<CatalogExercise>>(exerciseListPath(query));
      setExercises(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(`Failed to load exercises: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteExercise(exercise: CatalogExercise) {
    try {
      await apiFetch(`/exercises/${exercise.id}`, { method: "DELETE" });
      toast.success(`Deleted "${exercise.name}"`);
      void load();
    } catch (err) {
      toast.error(`Failed to delete exercise: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="exercises-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Build a library of exercises with media, muscles worked, and step-by-step instructions.">
          Exercise Catalogue
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/exercises/new")}>
          New exercise
        </Button>
      </div>
      <div className="mb-4">
        <label className="field-label" htmlFor="exercise-search">
          Search exercises
        </label>
        <Input
          id="exercise-search"
          type="search"
          placeholder="Name or alias, e.g. RDL"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!loading && total > exercises.length ? (
          <p className="mt-1 text-xs text-muted">
            Showing {exercises.length} of {total}. Search to narrow the list.
          </p>
        ) : null}
      </div>
      <ul id="exercises-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && exercises.length === 0 ? (
          <li>
            <EmptyState
              title={query.trim() ? "No matching exercises" : "No exercises yet"}
              description={
                query.trim()
                  ? "Try another name or alias, or add it with 'New exercise'."
                  : "Tap 'New exercise' to add your first catalogue entry."
              }
            />
          </li>
        ) : null}
        {exercises.map((exercise) => (
          <li
            key={exercise.id}
            className="card flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{exercise.name}</p>
              {exercise.primary_muscles.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                  {exercise.primary_muscles.map((muscle) => (
                    <span key={muscle} className="rounded-full bg-elevated px-2 py-0.5">
                      {muscle.replace("_", " ")}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/exercises/${exercise.id}`)}>View</Button>
              <Button onClick={() => void navigate(`/exercises/${exercise.id}/edit`)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(exercise)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteExercise(deleteTarget);
        }}
        title="Delete exercise"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </section>
  );
}
