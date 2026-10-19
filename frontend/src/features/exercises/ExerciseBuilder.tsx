import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, errorMessage } from "@/api/client";
import type { CatalogExercise, EquipmentTag, MuscleTag } from "@/api/types";
import { MUSCLE_TAGS } from "@/api/types";
import { MAX_EQUIPMENT_OPTIONS, toggleEquipmentTag } from "@/lib/equipment";
import { exercisePayloadSchema } from "@/lib/exercise-schema";
import { EQUIPMENT_LOAD_MODES, LOAD_MODE_LABELS } from "@/lib/load-rules";
import type { EquipmentLoadMode } from "@/lib/load-rules";
import { Button, Card, Input, PageHeading } from "@/ui";
import { EquipmentChips } from "@/ui/EquipmentChips";
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
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line-muted bg-surface text-muted hover:text-main"
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

function EquipmentTagsEditor({
  options,
  error,
  onChange,
}: {
  options: EquipmentTag[][] | null;
  error: string | undefined;
  onChange: (options: EquipmentTag[][] | null) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3" aria-label="Equipment tags">
      <legend className="field-label">Equipment tags</legend>
      {options === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">Read from the equipment text when you save.</p>
          <Button onClick={() => onChange([[]])}>Choose tags</Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            Any one option will do. An option needs everything picked in it. Locations use these
            tags to tell what you can do there.
          </p>
          {options.map((option, index) => (
            <div key={index} className="rounded-lg border border-line-muted p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Option {index + 1}</span>
                <Button
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => onChange(options.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
              <EquipmentChips
                label={`Option ${index + 1} equipment`}
                selected={option}
                onToggle={(tag) => onChange(toggleEquipmentTag(options, index, tag))}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {options.length < MAX_EQUIPMENT_OPTIONS ? (
              <Button onClick={() => onChange([...options, []])}>+ Add alternative</Button>
            ) : null}
            <Button onClick={() => onChange(null)}>Read from text instead</Button>
          </div>
        </>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </fieldset>
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
  equipment_any_of: EquipmentTag[][] | null;
  safety_notes: string;
  equipment_load_mode: EquipmentLoadMode;
  is_unilateral: boolean;
}) {
  return {
    name: state.name.trim(),
    aliases: state.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    media_url: state.media_url.trim() || null,
    primary_muscles: state.primary_muscles,
    secondary_muscles: state.secondary_muscles,
    instructions: state.instructions.map((step) => step.trim()).filter((step) => step.length > 0),
    equipment: state.equipment.trim() || null,
    equipment_any_of: state.equipment_any_of,
    safety_notes: state.safety_notes.trim() || null,
    equipment_load_mode: state.equipment_load_mode,
    is_unilateral: state.is_unilateral,
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
  // null: let the server read the tags from the equipment text.
  const [equipmentAnyOf, setEquipmentAnyOf] = useState<EquipmentTag[][] | null>(null);
  // Tags picked by hand in this edit survive text changes; otherwise they
  // follow the text, so editing "barbell" to "dumbbell" retags the exercise.
  const [tagsTouched, setTagsTouched] = useState(false);
  const [safetyNotes, setSafetyNotes] = useState("");
  const [loadMode, setLoadMode] = useState<EquipmentLoadMode>("standard");
  const [unilateral, setUnilateral] = useState(false);
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
    setEquipmentAnyOf(existing.equipment_any_of.length > 0 ? existing.equipment_any_of : null);
    setSafetyNotes(existing.safety_notes ?? "");
    setLoadMode(existing.equipment_load_mode);
    setUnilateral(existing.is_unilateral);
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
      equipment_any_of: equipmentAnyOf,
      safety_notes: safetyNotes,
      equipment_load_mode: loadMode,
      is_unilateral: unilateral,
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
            onChange={(event) => {
              setEquipment(event.target.value);
              if (!tagsTouched) setEquipmentAnyOf(null);
            }}
          />
        </div>

        <EquipmentTagsEditor
          options={equipmentAnyOf}
          error={errors.equipment_any_of}
          onChange={(options) => {
            setTagsTouched(options !== null);
            setEquipmentAnyOf(options);
          }}
        />

        <div>
          <label className="field-label" htmlFor="exercise-load-mode">
            Weight you type
          </label>
          <select
            id="exercise-load-mode"
            className="input"
            value={loadMode}
            onChange={(event) => setLoadMode(event.target.value as EquipmentLoadMode)}
          >
            {EQUIPMENT_LOAD_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {LOAD_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            id="exercise-unilateral"
            type="checkbox"
            className="h-5 w-5"
            checked={unilateral}
            onChange={(event) => setUnilateral(event.target.checked)}
          />
          <span>
            One side at a time: a set's reps are per leg or arm, and volume counts both sides
          </span>
        </label>

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
