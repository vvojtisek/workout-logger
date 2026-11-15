import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import { MUSCLE_TAGS } from "@/api/types";
import type { LoadEventOccurrence, MuscleTag, Paginated, WorkoutLog } from "@/api/types";
import { MUSCLE_LABELS } from "@/lib/exercise-catalogue";
import { activityBody, checkInBody, hockeyMinutes, optimisticLog } from "@/lib/quick-log";
import type { CoachLogBody, QuickActivity } from "@/lib/quick-log";
import { ENERGY_SCALE, SORENESS_SCALE, scaleLabel } from "@/lib/scales";
import type { Scale } from "@/lib/scales";
import { localIsoDate } from "@/lib/today";
import { Dialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button } from "@/ui";

export interface ReadinessLog {
  id: string;
  log_date: string;
  logged_at: string;
  soreness: number | null;
  sore_muscle_groups: MuscleTag[];
  fatigue: number | null;
  sleep_quality: number | null;
  score: number;
  load_factor: number;
}

interface CoachLogResult {
  readiness_log: ReadinessLog | null;
  workout_log: WorkoutLog | null;
}

/** How long the "Edit details" toast stays after a one-tap log. */
const EDIT_TOAST_MS = 5000;

const LABELS: Record<QuickActivity, string> = {
  swim_sauna: "Swim + sauna",
  ice_hockey: "Ice hockey",
};

/** Three one-tap logs on the phone home: swim + sauna, hockey, and the
 * soreness/energy check-in. Activities show in Today's summary before the
 * server answers; a failure takes them out again. */
export function QuickLogBar({
  now,
  occurrences,
  logsKey,
  readinessKey,
}: {
  now: Date;
  occurrences: LoadEventOccurrence[];
  logsKey: readonly unknown[];
  readinessKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [checkInOpen, setCheckInOpen] = useState(false);
  const minutes = hockeyMinutes(occurrences, localIsoDate(now));

  const logActivity = useMutation({
    mutationFn: (kind: QuickActivity) =>
      apiFetch<CoachLogResult>("/coach/log", {
        method: "POST",
        body: JSON.stringify(activityBody(kind, minutes)),
      }),
    onMutate: async (kind) => {
      await queryClient.cancelQueries({ queryKey: logsKey });
      const previous = queryClient.getQueryData<Paginated<WorkoutLog>>(logsKey);
      const pending = optimisticLog(kind, new Date(), minutes);
      queryClient.setQueryData<Paginated<WorkoutLog>>(logsKey, (current) =>
        current
          ? { ...current, items: [pending, ...current.items], total: current.total + 1 }
          : { items: [pending], total: 1, limit: 100, offset: 0 },
      );
      return { previous };
    },
    onSuccess: (result, kind) => {
      const saved = result.workout_log;
      toast.success(`${LABELS[kind]} logged`, {
        durationMs: EDIT_TOAST_MS,
        action: saved
          ? { label: "Edit details", onClick: () => void navigate(`/history/${saved.id}?edit=1`) }
          : undefined,
      });
    },
    onError: (err, kind, context) => {
      queryClient.setQueryData(logsKey, context?.previous);
      toast.error(`Failed to log ${LABELS[kind].toLowerCase()}: ${errorMessage(err)}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: logsKey }),
  });

  const checkIn = useMutation({
    mutationFn: (body: CoachLogBody) =>
      apiFetch<CoachLogResult>("/coach/log", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => {
      const saved = result.readiness_log;
      if (saved) queryClient.setQueryData(readinessKey, { items: [saved] });
      toast.success(saved ? `Check-in saved · readiness ${saved.score}/100` : "Check-in saved", {
        durationMs: EDIT_TOAST_MS,
        action: { label: "Edit details", onClick: () => setCheckInOpen(true) },
      });
    },
    onError: (err) => toast.error(`Failed to save check-in: ${errorMessage(err)}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: readinessKey }),
  });

  return (
    <section aria-label="Quick log" data-testid="quick-log" className="flex flex-col gap-2 border-t border-line-muted pt-5">
      <div className="grid grid-cols-3 gap-2">
        <QuickButton
          testId="quick-swim-sauna"
          title="Swim + sauna"
          hint="30 min · 30 laps · 3× sauna"
          onClick={() => logActivity.mutate("swim_sauna")}
        />
        <QuickButton
          testId="quick-hockey"
          title="Ice hockey"
          hint={`${minutes} min`}
          onClick={() => logActivity.mutate("ice_hockey")}
        />
        <QuickButton
          testId="quick-check-in"
          title="Check-in"
          hint="Soreness · energy"
          onClick={() => setCheckInOpen(true)}
        />
      </div>
      {checkInOpen ? (
        <CheckInDialog
          saving={checkIn.isPending}
          onClose={() => setCheckInOpen(false)}
          onSave={(body) => {
            setCheckInOpen(false);
            checkIn.mutate(body);
          }}
        />
      ) : null}
    </section>
  );
}

function QuickButton({
  testId,
  title,
  hint,
  onClick,
}: {
  testId: string;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-[var(--radius-md)] border border-line bg-elevated px-2.5 py-2 text-left active:bg-accent-soft"
    >
      <span className="text-sm leading-tight font-semibold">{title}</span>
      <span data-numeric className="text-[11px] leading-tight text-muted">
        {hint}
      </span>
    </button>
  );
}

function ScaleSlider({
  id,
  scale,
  label,
  value,
  onChange,
}: {
  id: string;
  scale: Scale;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const meaning = scaleLabel(scale, value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <output htmlFor={id} data-numeric className="text-sm">
          {value} · {meaning}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={scale.max}
        step={1}
        value={value}
        aria-valuetext={`${value} ${meaning}`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full accent-[var(--color-accent)]"
      />
      <p className="text-xs text-muted">{scale.hint}</p>
    </div>
  );
}

function CheckInDialog({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: CoachLogBody) => void;
}) {
  const [soreness, setSoreness] = useState(3);
  const [energy, setEnergy] = useState(7);
  const [muscles, setMuscles] = useState<MuscleTag[]>([]);

  function toggle(muscle: MuscleTag) {
    setMuscles((current) =>
      current.includes(muscle) ? current.filter((item) => item !== muscle) : [...current, muscle],
    );
  }

  return (
    <Dialog open onClose={onClose} title="How do you feel?">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(checkInBody(soreness, energy, muscles, new Date()));
        }}
      >
        <ScaleSlider id="check-in-soreness" scale={SORENESS_SCALE} label="Soreness" value={soreness} onChange={setSoreness} />
        {soreness >= 2 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold">Where is it sore?</legend>
            <div className="flex flex-wrap gap-1.5">
              {MUSCLE_TAGS.filter((muscle) => muscle !== "full_body").map((muscle) => (
                <button
                  key={muscle}
                  type="button"
                  aria-pressed={muscles.includes(muscle)}
                  onClick={() => toggle(muscle)}
                  className={`min-h-11 rounded-full border px-3 py-1.5 text-sm ${
                    muscles.includes(muscle) ? "border-accent bg-accent-soft text-main" : "border-line bg-elevated text-main"
                  }`}
                >
                  {MUSCLE_LABELS[muscle]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <ScaleSlider id="check-in-energy" scale={ENERGY_SCALE} label="Energy" value={energy} onChange={setEnergy} />
        <div className="grid grid-cols-2 gap-2">
          <Button touch onClick={onClose}>
            Cancel
          </Button>
          <Button touch variant="primary" type="submit" disabled={saving}>
            Save check-in
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
