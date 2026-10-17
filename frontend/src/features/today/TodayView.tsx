import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type {
  BodyMetricTrends,
  LoadEventOccurrence,
  LoadWarning,
  Location,
  LocationCheck,
  MealEntry,
  NutritionDailySummary,
  Paginated,
  ScheduledWorkout,
  SleepEntry,
  WorkoutLogSummary,
  WorkoutPlan,
  WorkoutSession,
} from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { LocationCheckDialog } from "@/features/locations/LocationCheckDialog";
import { LOAD_EVENT_KIND_LABELS, clockTime, loadWarningMessage } from "@/lib/load-events";
import { readTrainingLocation, writeTrainingLocation } from "@/lib/locations";
import { FEELING_SCALE, SLEEP_QUALITY_SCALE, scaleLabel, scaleText, scaleValues } from "@/lib/scales";
import type { Scale } from "@/lib/scales";
import {
  clockText,
  dayHeading,
  deviceTimezone,
  formatSleepDuration,
  hockeyLogPayload,
  hockeyToConfirm,
  isoWeek,
  localIsoDate,
  nextSportEvent,
  occurrenceKey,
  readSkippedEvents,
  repeatMealPayload,
  repeatableMeals,
  shiftMinutes,
  sleepDefaults,
  sleepPayload,
  writeSkippedEvent,
} from "@/lib/today";
import type { RepeatableMeal } from "@/lib/today";
import { toast } from "@/ui/Toast";
import { Button, Card } from "@/ui";

interface CalendarWindow {
  items: ScheduledWorkout[];
  load_events?: LoadEventOccurrence[];
  load_warnings?: LoadWarning[];
}

const TODAY_KEY = ["today"] as const;
// Entries made on other screens must show the moment you come back here.
const FRESH = { staleTime: 0 } as const;

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function TodayCard({ title, aside, children, testId }: { title: string; aside?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <section aria-label={title} data-testid={testId} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
          {aside ? <span className="text-xs text-dim">{aside}</span> : null}
        </div>
        {children}
      </section>
    </Card>
  );
}

/** One tap on a number saves; each number carries its plain-language label. */
function ScalePicker({
  scale,
  label,
  onPick,
  disabled,
}: {
  scale: Scale;
  label: string;
  onPick: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-5 gap-1.5">
      {scaleValues(scale).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(value)}
          aria-label={`${value} ${scaleLabel(scale, value)}`}
          className="flex min-h-12 flex-col items-center justify-center rounded-[var(--radius-sm)] border border-line bg-elevated px-1 py-1.5 disabled:opacity-50"
        >
          <span data-numeric className="text-base font-semibold">
            {value}
          </span>
          <span className="text-[10px] leading-tight text-muted">{scaleLabel(scale, value)}</span>
        </button>
      ))}
    </div>
  );
}

function Stepper({ id, label, value, onStep }: { id: string; label: string; value: number; onStep: (delta: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-xs text-muted">
        {label}
      </span>
      <div className="grid grid-cols-[56px_1fr_56px] items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <Button touch aria-label={`${label} 15 minutes earlier`} onClick={() => onStep(-15)}>
          −15
        </Button>
        <output id={id} data-numeric aria-labelledby={`${id}-label`} className="text-center text-xl font-semibold">
          {clockText(value)}
        </output>
        <Button touch aria-label={`${label} 15 minutes later`} onClick={() => onStep(15)}>
          +15
        </Button>
      </div>
    </div>
  );
}

export function TodayView() {
  const now = useMemo(() => new Date(), []);
  const today = localIsoDate(now);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: TODAY_KEY });

  const calendar = useQuery({
    queryKey: [...TODAY_KEY, "calendar", today],
    ...FRESH,
    queryFn: () => apiFetch<CalendarWindow>(`/calendar?from=${today}&to=${localIsoDate(addDays(now, 7))}`),
  });
  const sleep = useQuery({
    queryKey: [...TODAY_KEY, "sleep"],
    ...FRESH,
    queryFn: () => apiFetch<Paginated<SleepEntry>>("/sleep-entries?limit=5"),
  });
  const body = useQuery({
    queryKey: [...TODAY_KEY, "body"],
    ...FRESH,
    queryFn: () => apiFetch<BodyMetricTrends>("/body-metrics/trends"),
  });
  const logs = useQuery({
    queryKey: [...TODAY_KEY, "logs"],
    ...FRESH,
    queryFn: () => apiFetch<Paginated<WorkoutLogSummary>>("/logs?limit=20"),
  });

  const occurrences = calendar.data?.load_events ?? [];
  const next = nextSportEvent(occurrences, now);
  const latestSleep = sleep.data?.items[0] ?? null;
  const weight = body.data?.latest?.weight_kg;

  return (
    <section id="today-view" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{dayHeading(now)}</h2>
        <span data-numeric className="text-xs text-muted">
          Week {isoWeek(now)}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2" aria-label="At a glance">
        <Glance label="Sleep" value={latestSleep ? formatSleepDuration(latestSleep.time_in_bed_seconds) : "–"} />
        <Glance label="Weight" value={weight != null ? `${weight} kg` : "–"} />
        <Glance label="Next sport" value={next ? next.when : "None"} />
      </dl>

      <CoachCard now={now} calendar={calendar.data} onChange={refresh} />
      <HockeyCards now={now} occurrences={occurrences} logs={logs.data?.items ?? []} onChange={refresh} />
      <SleepCard now={now} entries={sleep.data?.items} onChange={refresh} />
      <FoodCard now={now} onChange={refresh} />
    </section>
  );
}

function Glance({ label, value }: { label: string; value: string }) {
  return (
    <div className="card min-w-0 px-2.5 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd data-numeric className="truncate text-sm font-semibold">
        {value}
      </dd>
    </div>
  );
}

function CoachCard({ now, calendar, onChange }: { now: Date; calendar: CalendarWindow | undefined; onChange: () => void }) {
  const { session, openSession } = useAppContext();
  const navigate = useNavigate();
  const today = localIsoDate(now);
  const [pickedLocation, setPickedLocation] = useState<string | null>(null);
  const [pendingCheck, setPendingCheck] = useState<{ session: WorkoutSession; check: LocationCheck } | null>(null);
  const [starting, setStarting] = useState(false);

  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: () => apiFetch<Paginated<WorkoutPlan>>("/plans?limit=100"),
  });
  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiFetch<Paginated<Location>>("/locations?limit=100"),
  });
  const locations = locationsQuery.data?.items ?? [];
  const locationId =
    pickedLocation ??
    readTrainingLocation(
      window.localStorage,
      locations.map((location) => location.id),
    );

  function pickLocation(id: string) {
    setPickedLocation(id);
    writeTrainingLocation(window.localStorage, id);
  }

  const scheduled = (calendar?.items ?? []).filter((item) => item.scheduled_date === today);
  const open = scheduled.find((item) => item.status === "scheduled");
  const done = scheduled.find((item) => item.status === "completed");
  const warning = open ? calendar?.load_warnings?.find((item) => item.scheduled_workout_id === open.id) : undefined;

  async function start(request: () => Promise<WorkoutSession>) {
    setStarting(true);
    try {
      const started = await request();
      onChange();
      if (started.location_id) {
        // Advisory only: if the check fails, the workout still starts.
        const check = await apiFetch<LocationCheck>(`/workout-sessions/${started.id}/location-check`).catch(() => null);
        if (check && check.items.length > 0) {
          setPendingCheck({ session: started, check });
          return;
        }
      }
      openSession(started);
    } catch (err) {
      toast.error(`Failed to start workout: ${errorMessage(err)}`);
    } finally {
      setStarting(false);
    }
  }

  function startPlan(planId: string) {
    void start(() =>
      apiFetch<WorkoutSession>("/workout-sessions", {
        method: "POST",
        body: JSON.stringify({ source_plan_id: planId, location_id: locationId || null }),
      }),
    );
  }

  let content: ReactNode;
  if (session) {
    content = (
      <>
        <p className="text-base font-semibold">{session.source_plan_name}</p>
        <p className="text-sm text-muted">Workout in progress.</p>
        <Button variant="primary" touch onClick={() => void navigate("/workout")}>
          Resume workout
        </Button>
      </>
    );
  } else if (open) {
    content = (
      <>
        <p className="text-base font-semibold">{open.workout_plan_name}</p>
        {open.program_name ? <p className="text-sm text-muted">{open.program_name}</p> : null}
        {warning ? (
          <p role="note" className="rounded-[var(--radius-sm)] bg-warn-soft px-2.5 py-2 text-sm text-warn">
            {loadWarningMessage(warning, today)}
          </p>
        ) : null}
        <Button
          variant="primary"
          touch
          disabled={starting}
          onClick={() =>
            void start(() => apiFetch<WorkoutSession>(`/scheduled-workouts/${open.id}/start`, { method: "POST" }))
          }
        >
          Start session
        </Button>
      </>
    );
  } else {
    const quickPlans = (plans.data?.items ?? []).slice(0, 3);
    content = (
      <>
        <p className="text-sm text-muted">
          {done ? `Done today: ${done.workout_plan_name}.` : "Nothing scheduled today."}
        </p>
        {!done && quickPlans.length > 0 ? (
          <>
            {locations.length > 0 ? (
              <div role="group" aria-label="Training at" className="flex flex-wrap gap-1.5">
                {locations.map((location) => (
                  <Chip key={location.id} pressed={locationId === location.id} onClick={() => pickLocation(location.id)}>
                    {location.name}
                  </Chip>
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {quickPlans.map((plan) => (
                <Button key={plan.id} touch disabled={starting} onClick={() => startPlan(plan.id)}>
                  Start {plan.name}
                </Button>
              ))}
            </div>
          </>
        ) : null}
        {!done && quickPlans.length === 0 && plans.isSuccess ? (
          <Button onClick={() => void navigate("/plans/new")}>Create a plan</Button>
        ) : null}
      </>
    );
  }

  return (
    <TodayCard title="Coach · today" testId="today-coach">
      {content}
      {pendingCheck ? (
        <LocationCheckDialog
          session={pendingCheck.session}
          check={pendingCheck.check}
          onDone={(next) => {
            setPendingCheck(null);
            openSession(next);
          }}
        />
      ) : null}
    </TodayCard>
  );
}

function Chip({ pressed, onClick, children }: { pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 py-1.5 text-sm ${
        pressed ? "border-accent bg-accent-soft text-main" : "border-line bg-elevated text-main"
      }`}
    >
      {children}
    </button>
  );
}

function HockeyCards({
  now,
  occurrences,
  logs,
  onChange,
}: {
  now: Date;
  occurrences: LoadEventOccurrence[];
  logs: WorkoutLogSummary[];
  onChange: () => void;
}) {
  const [skipped, setSkipped] = useState(() => readSkippedEvents(window.localStorage));
  const save = useMutation({
    mutationFn: ({ occurrence, feeling }: { occurrence: LoadEventOccurrence; feeling: number }) =>
      apiFetch("/logs", { method: "POST", body: JSON.stringify(hockeyLogPayload(occurrence, feeling)) }),
    onSuccess: () => {
      toast.success("Ice hockey saved");
      onChange();
    },
    onError: (err) => toast.error(`Failed to save hockey: ${errorMessage(err)}`),
  });

  return (
    <>
      {hockeyToConfirm(occurrences, logs, skipped, now).map((occurrence) => (
        <TodayCard
          key={occurrenceKey(occurrence)}
          title={`Hockey ${LOAD_EVENT_KIND_LABELS[occurrence.kind].toLowerCase()}`}
          aside={`${clockTime(occurrence.start_time)}, ${occurrence.duration_minutes} min`}
          testId="today-hockey"
        >
          <p className="text-base font-semibold">{occurrence.name}</p>
          <p className="text-sm text-muted">Did you play? Tap how it felt to save it. Higher is better.</p>
          <ScalePicker
            scale={FEELING_SCALE}
            label="How hockey felt"
            disabled={save.isPending}
            onPick={(feeling) => save.mutate({ occurrence, feeling })}
          />
          <Button
            variant="ghost"
            onClick={() => {
              writeSkippedEvent(window.localStorage, occurrenceKey(occurrence));
              setSkipped(readSkippedEvents(window.localStorage));
            }}
          >
            Didn't play
          </Button>
        </TodayCard>
      ))}
    </>
  );
}

function SleepCard({ now, entries, onChange }: { now: Date; entries: SleepEntry[] | undefined; onChange: () => void }) {
  const today = localIsoDate(now);
  const latest = entries?.[0] ?? null;
  const lastNight = entries?.find((entry) => entry.sleep_date === today) ?? null;
  const defaults = sleepDefaults(latest);
  const [bed, setBed] = useState<number | null>(null);
  const [wake, setWake] = useState<number | null>(null);
  const bedMinutes = bed ?? defaults.bedMinutes;
  const wakeMinutes = wake ?? defaults.wakeMinutes;

  const save = useMutation({
    mutationFn: (quality: number) =>
      apiFetch("/sleep-entries", {
        method: "POST",
        body: JSON.stringify(sleepPayload(now, bedMinutes, wakeMinutes, quality, deviceTimezone())),
      }),
    onSuccess: () => {
      toast.success("Sleep saved");
      onChange();
    },
    onError: (err) => toast.error(`Failed to save sleep: ${errorMessage(err)}`),
  });

  if (!entries) return null;
  if (lastNight) {
    return (
      <TodayCard title="Last night" aside={lastNight.source === "manual" ? undefined : lastNight.source} testId="today-sleep">
        <p className="text-sm">
          <span data-numeric className="font-semibold">
            {formatSleepDuration(lastNight.time_in_bed_seconds)}
          </span>
          {lastNight.quality_score != null ? ` · Quality ${scaleText(SLEEP_QUALITY_SCALE, lastNight.quality_score)}` : ""}
        </p>
      </TodayCard>
    );
  }
  return (
    <TodayCard title="Last night" testId="today-sleep">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stepper id="today-bed" label="Went to bed" value={bedMinutes} onStep={(delta) => setBed(shiftMinutes(bedMinutes, delta))} />
        <Stepper id="today-wake" label="Woke up" value={wakeMinutes} onStep={(delta) => setWake(shiftMinutes(wakeMinutes, delta))} />
      </div>
      <p className="text-sm text-muted">How rested do you feel? Tap to save. Higher is better.</p>
      <ScalePicker scale={SLEEP_QUALITY_SCALE} label="How rested" disabled={save.isPending} onPick={(quality) => save.mutate(quality)} />
    </TodayCard>
  );
}

function FoodCard({ now, onChange }: { now: Date; onChange: () => void }) {
  const navigate = useNavigate();
  const today = localIsoDate(now);
  const daily = useQuery({
    queryKey: [...TODAY_KEY, "nutrition", today],
    ...FRESH,
    queryFn: () => apiFetch<NutritionDailySummary>(`/nutrition/daily?date=${today}`),
  });
  const meals = useQuery({
    queryKey: [...TODAY_KEY, "meals"],
    ...FRESH,
    queryFn: () => apiFetch<Paginated<MealEntry>>("/meal-entries?limit=50"),
  });
  const repeat = useMutation({
    mutationFn: (meal: RepeatableMeal) =>
      apiFetch<MealEntry>("/meal-entries", { method: "POST", body: JSON.stringify(repeatMealPayload(meal.entry, new Date())) }),
    onSuccess: (_created, meal) => {
      toast.success(`Logged ${meal.label}`);
      onChange();
    },
    onError: (err) => toast.error(`Failed to log meal: ${errorMessage(err)}`),
  });

  const totals = daily.data?.totals;
  const target = daily.data?.target;
  const options = repeatableMeals(meals.data?.items ?? []);

  return (
    <TodayCard title="Food today" testId="today-food">
      {totals ? (
        <div className="flex flex-col gap-2">
          <Meter label="Energy" value={totals.energy_kcal} target={target?.energy_target_kcal} unit="kcal" />
          <Meter label="Protein" value={totals.protein_g} target={target?.protein_target_g} unit="g" />
        </div>
      ) : null}
      {options.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted">Eat one of these again? One tap logs it now.</p>
          <div role="group" aria-label="Repeat a meal" className="flex flex-wrap gap-1.5">
            {options.map((meal) => (
              <button
                key={meal.key}
                type="button"
                disabled={repeat.isPending}
                onClick={() => repeat.mutate(meal)}
                className="min-h-9 max-w-full truncate rounded-full border border-line bg-elevated px-3 py-1.5 text-left text-sm disabled:opacity-50"
              >
                {meal.label}
                <span data-numeric className="ml-1 text-muted">
                  {meal.energyKcal} kcal
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Button touch onClick={() => void navigate("/nutrition/meals/new")}>
        Log other food
      </Button>
    </TodayCard>
  );
}

function Meter({ label, value, target, unit }: { label: string; value: number; target: number | undefined; unit: string }) {
  const shown = Math.round(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span data-numeric className="text-main">
          {target ? `${shown} / ${Math.round(target)} ${unit}` : `${shown} ${unit}`}
        </span>
      </div>
      {target ? <progress aria-label={`${label} against target`} max={target} value={Math.min(value, target)} /> : null}
    </div>
  );
}
