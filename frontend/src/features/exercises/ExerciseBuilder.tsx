import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, errorMessage } from "@/api/client";
import type { CatalogExercise, MuscleTag } from "@/api/types";
import { MUSCLE_TAGS } from "@/api/types";
import { exercisePayloadSchema } from "@/lib/exercise-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

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

function MuscleTagPicker({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: MuscleTag[];
  onToggle: (tag: MuscleTag) => void;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {MUSCLE_TAGS.map((tag) => {
          const active = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(tag)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                active
                  ? "border-accent bg-accent text-white"
                  : "border-border-subtle bg-surface text-muted hover:text-text"
              }`}
              style={{ minHeight: "var(--touch)" }}
            >
              {MUSCLE_LABELS[tag]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListEditor({
  legend,
  items,
  placeholder,
  addLabel,
  errors,
  onChange,
}: {
  legend: string;
  items: string[];
  placeholder: string;
  addLabel: string;
  errors: Record<number, string>;
  onChange: (items: string[]) => void;
}) {
  return (
    <div>
      <span className="field-label">{legend}</span>
      <div className="flex flex-col gap-2">
        {items.map((value, index) => (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-sm text-muted">{index + 1}.</span>
              <Input
                aria-label={`${legend} ${index + 1}`}
                value={value}
                placeholder={placeholder}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              />
              <Button
                aria-label={`Remove ${legend.toLowerCase()} ${index + 1}`}
                variant="ghost"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
            {errors[index] ? (
              <p className="ml-8 text-sm text-danger">{errors[index]}</p>
            ) : null}
          </div>
        ))}
      </div>
      <Button className="mt-2" onClick={() => onChange([...items, ""])}>
        {addLabel}
      </Button>
    </div>
  );
}

function buildPayload(state: {
  name: string;
  aliases: string[];
  media_url: string;
  primary_muscles: MuscleTag[];
  secondary_muscles: MuscleTag[];
  instructions: string[];
  equipment: string;
  safety_notes: string;
}) {
  return {
    name: state.name.trim(),
    aliases: state.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    media_url: state.media_url.trim() || null,
    primary_muscles: state.primary_muscles,
    secondary_muscles: state.secondary_muscles,
    instructions: state.instructions.map((step) => step.trim()).filter((step) => step.length > 0),
    equipment: state.equipment.trim() || null,
    safety_notes: state.safety_notes.trim() || null,
  };
}

export function ExerciseBuilder() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const isEditing = Boolean(exerciseId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [primaryMuscles, setPrimaryMuscles] = useState<MuscleTag[]>([]);
  const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleTag[]>([]);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [equipment, setEquipment] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededExerciseId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["exercise", exerciseId],
    queryFn: () => apiFetch<CatalogExercise>(`/exercises/${exerciseId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededExerciseId.current === existing.id) return;
    seededExerciseId.current = existing.id;
    setName(existing.name);
    setAliases(existing.aliases);
    setMediaUrl(existing.media_url ?? "");
    setPrimaryMuscles(existing.primary_muscles);
    setSecondaryMuscles(existing.secondary_muscles);
    setInstructions(existing.instructions);
    setEquipment(existing.equipment ?? "");
    setSafetyNotes(existing.safety_notes ?? "");
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<CatalogExercise>(`/exercises/${exerciseId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<CatalogExercise>("/exercises", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
    onSuccess: (exercise) => {
      void queryClient.invalidateQueries({ queryKey: ["exercises"] });
      toast.success(isEditing ? `Updated "${exercise.name}"` : `Created "${exercise.name}"`);
      void navigate(`/exercises/${exercise.id}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "EXERCISE_NAME_CONFLICT") {
        setErrors((prev) => ({ ...prev, name: err.message }));
        return;
      }
      toast.error(`Failed to save exercise: ${errorMessage(err)}`);
    },
  });

  function toggleMuscle(list: MuscleTag[], setList: (tags: MuscleTag[]) => void, tag: MuscleTag) {
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);
  }

  function submit() {
    const payload = buildPayload({
      name,
      aliases,
      media_url: mediaUrl,
      primary_muscles: primaryMuscles,
      secondary_muscles: secondaryMuscles,
      instructions,
      equipment,
      safety_notes: safetyNotes,
    });
    const result = exercisePayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const [first, second] = issue.path;
        if ((first === "aliases" || first === "instructions") && typeof second === "number") {
          nextErrors[`${String(first)}.${second}`] = issue.message;
        } else {
          nextErrors[String(first)] = issue.message;
        }
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  const aliasErrors: Record<number, string> = {};
  const instructionErrors: Record<number, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith("aliases.")) aliasErrors[Number(key.split(".")[1])] = message;
    if (key.startsWith("instructions.")) instructionErrors[Number(key.split(".")[1])] = message;
  }

  if (isEditing && isLoading) {
    return (
      <section id="exercise-builder-view">
        <PageHeading>{isEditing ? "Edit Exercise" : "New Exercise"}</PageHeading>
        <p className="text-sm text-muted">Loading exercise…</p>
      </section>
    );
  }

  return (
    <section id="exercise-builder-view">
      <PageHeading hint="Link out to hosted video or self-hosted MP4. Media URLs must be https://.">
        {isEditing ? "Edit Exercise" : "New Exercise"}
      </PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <label className="field-label" htmlFor="exercise-name">
            Name
          </label>
          <Input id="exercise-name" value={name} onChange={(event) => setName(event.target.value)} />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>

        <ListEditor
          legend="Aliases"
          items={aliases}
          placeholder="e.g. Flat Bench"
          addLabel="+ Add alias"
          errors={aliasErrors}
          onChange={setAliases}
        />

        <div>
          <label className="field-label" htmlFor="exercise-media-url">
            Media URL (optional)
          </label>
          <Input
            id="exercise-media-url"
            placeholder="https://example.com/videos/exercise.mp4"
            value={mediaUrl}
            onChange={(event) => setMediaUrl(event.target.value)}
          />
          {errors.media_url ? (
            <p className="mt-1 text-sm text-danger">{errors.media_url}</p>
          ) : null}
        </div>

        <MuscleTagPicker
          label="Primary muscles"
          selected={primaryMuscles}
          onToggle={(tag) => toggleMuscle(primaryMuscles, setPrimaryMuscles, tag)}
        />
        <MuscleTagPicker
          label="Secondary muscles"
          selected={secondaryMuscles}
          onToggle={(tag) => toggleMuscle(secondaryMuscles, setSecondaryMuscles, tag)}
        />

        <ListEditor
          legend="Instructions"
          items={instructions}
          placeholder="Describe this step"
          addLabel="+ Add step"
          errors={instructionErrors}
          onChange={setInstructions}
        />

        <div>
          <label className="field-label" htmlFor="exercise-equipment">
            Equipment (optional)
          </label>
          <Input
            id="exercise-equipment"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="exercise-safety-notes">
            Safety notes (optional)
          </label>
          <textarea
            id="exercise-safety-notes"
            className="input"
            rows={3}
            value={safetyNotes}
            onChange={(event) => setSafetyNotes(event.target.value)}
          />
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-exercise-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Create exercise"}
        </Button>
        <Button onClick={() => void navigate("/exercises")}>Cancel</Button>
      </div>
    </section>
  );
}
