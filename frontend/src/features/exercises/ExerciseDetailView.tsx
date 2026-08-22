import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { CatalogExercise, MuscleTag } from "@/api/types";
import { Button, Card, EmptyState, PageHeading } from "@/ui";

const MUSCLE_LABELS: Record<MuscleTag, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  full_body: "Full body",
};

function MuscleBadgeList({ title, muscles }: { title: string; muscles: MuscleTag[] }) {
  if (muscles.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-medium text-muted">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {muscles.map((muscle) => (
          <li
            key={muscle}
            className="rounded-full bg-surface-raised px-3 py-1 text-sm font-medium"
          >
            {MUSCLE_LABELS[muscle]}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The CSP's default-src 'self' has no media-src override, so a cross-origin
// <video src> is blocked outright. Same-origin media (self-hosted under this
// app's own domain) plays inline; anything else must be a link-out card.
function isSameOriginMedia(mediaUrl: string): boolean {
  try {
    return new URL(mediaUrl, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function MediaContainer({ mediaUrl }: { mediaUrl: string | null }) {
  if (!mediaUrl) {
    return (
      <EmptyState
        title="No media yet"
        description="Add a media URL when editing this exercise to show a demonstration here."
      />
    );
  }
  if (isSameOriginMedia(mediaUrl)) {
    return (
      <video
        controls
        preload="none"
        className="aspect-video w-full rounded-xl bg-black"
        src={mediaUrl}
      >
        Your browser does not support embedded video.
      </video>
    );
  }
  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="card flex items-center justify-between gap-3 p-4 hover:bg-surface-raised"
    >
      <div className="min-w-0">
        <p className="font-medium">Watch demonstration</p>
        <p className="mt-0.5 truncate text-sm text-muted">{mediaUrl}</p>
      </div>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function ExerciseDetailView() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();

  const { data: exercise, isLoading, error } = useQuery({
    queryKey: ["exercise", exerciseId],
    queryFn: () => apiFetch<CatalogExercise>(`/exercises/${exerciseId}`),
  });

  if (isLoading) {
    return (
      <section id="exercise-detail-view">
        <p className="text-sm text-muted">Loading exercise…</p>
      </section>
    );
  }

  if (error || !exercise) {
    return (
      <section id="exercise-detail-view">
        <p className="text-sm text-danger">Failed to load exercise: {errorMessage(error)}</p>
      </section>
    );
  }

  return (
    <section id="exercise-detail-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading
          hint={exercise.aliases.length > 0 ? `Also known as: ${exercise.aliases.join(", ")}` : undefined}
        >
          {exercise.name}
        </PageHeading>
        <Button onClick={() => void navigate(`/exercises/${exercise.id}/edit`)}>Edit</Button>
      </div>

      <Card className="p-4">
        <MediaContainer mediaUrl={exercise.media_url} />
      </Card>

      <Card className="mt-4 flex flex-col gap-3 p-4">
        {exercise.primary_muscles.length === 0 && exercise.secondary_muscles.length === 0 ? (
          <p className="text-sm text-muted">No muscle groups recorded for this exercise.</p>
        ) : (
          <>
            <MuscleBadgeList title="Primary muscles" muscles={exercise.primary_muscles} />
            <MuscleBadgeList title="Secondary muscles" muscles={exercise.secondary_muscles} />
          </>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h3 className="mb-2 font-medium">Instructions</h3>
        {exercise.instructions.length === 0 ? (
          <p className="text-sm text-muted">No instructions recorded for this exercise.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {exercise.instructions.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-white"
                >
                  {index + 1}
                </span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {exercise.equipment || exercise.safety_notes ? (
        <Card className="mt-4 flex flex-col gap-3 p-4">
          {exercise.equipment ? (
            <div>
              <h3 className="text-sm font-medium text-muted">Equipment</h3>
              <p>{exercise.equipment}</p>
            </div>
          ) : null}
          {exercise.safety_notes ? (
            <div>
              <h3 className="text-sm font-medium text-muted">Safety notes</h3>
              <p>{exercise.safety_notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
