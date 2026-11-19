import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { BodyMetric } from "@/api/types";
import {
  bodyMetricPayloadSchema,
  measurementMax,
  type BodyMetricPayload,
} from "@/lib/body-metric-schema";
import {
  localDateTimeInputToIso,
  nowAsLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/lib/date-time-inputs";
import { Block, Button, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";
import { MeasurementControl } from "./MeasurementControl";

const DAILY = ["weight_kg", "body_fat_percent", "waist_cm"] as const;
const OTHER = [
  "neck_cm",
  "chest_cm",
  "hips_cm",
  "biceps_cm",
  "forearms_cm",
  "thighs_cm",
  "calves_cm",
] as const;
const MEASUREMENTS = [...DAILY, ...OTHER];
type Measurement = (typeof MEASUREMENTS)[number];
type Defaults = Record<Measurement, number | null>;

const labels: Record<Measurement, string> = {
  weight_kg: "Weight (kg)",
  body_fat_percent: "Body fat (%)",
  waist_cm: "Waist (cm)",
  neck_cm: "Neck (cm)",
  chest_cm: "Chest (cm)",
  hips_cm: "Hips (cm)",
  biceps_cm: "Biceps (cm)",
  forearms_cm: "Forearms (cm)",
  thighs_cm: "Thighs (cm)",
  calves_cm: "Calves (cm)",
};

export function BiometricEntryForm() {
  const { metricId } = useParams<{ metricId: string }>();
  const existing = useQuery({
    queryKey: ["body-metric", metricId],
    queryFn: () => apiFetch<BodyMetric>(`/body-metrics/${metricId}`),
    enabled: Boolean(metricId),
  });
  const defaults = useQuery({
    queryKey: ["body-metrics", "entry-defaults"],
    queryFn: () => apiFetch<Defaults>("/body-metrics/entry-defaults"),
    enabled: !metricId,
    gcTime: 0,
  });

  return (
    <section id="biometric-form-view">
      <PageHeading>{metricId ? "Edit Entry" : "Log Biometrics"}</PageHeading>
      {(metricId ? existing : defaults).isLoading ? (
        <p className="text-sm text-muted">Loading measurements…</p>
      ) : metricId && !existing.data ? (
        <p role="alert" className="text-sm text-danger">
          Could not load this entry.
        </p>
      ) : (
        <>
          {!metricId && defaults.isError && (
            <p role="status" className="text-sm text-muted">
              Previous measurements are unavailable. You can enter values manually.
            </p>
          )}
          <MetricForm
            key={metricId ?? "new"}
            metric={existing.data}
            defaults={metricId ? existing.data : defaults.data}
          />
        </>
      )}
    </section>
  );
}

function MetricForm({ metric, defaults }: { metric?: BodyMetric; defaults?: Defaults }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [when, setWhen] = useState(() =>
    (metric ? toLocalDateTimeInput(metric.measured_at) : nowAsLocalDateTimeInput()).split(" "),
  );
  const [fields, setFields] = useState(() =>
    Object.fromEntries(MEASUREMENTS.map((key) => [key, String(defaults?.[key] ?? "")])),
  );
  const [included, setIncluded] = useState(
    () =>
      new Set<Measurement>([
        ...DAILY.filter((key) => defaults?.[key] != null),
        ...OTHER.filter((key) => metric?.[key] != null),
      ]),
  );
  const otherCount = OTHER.filter((key) => included.has(key)).length;
  const [expanded, setExpanded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: BodyMetricPayload) =>
      apiFetch<BodyMetric>(metric ? `/body-metrics/${metric.id}` : "/body-metrics", {
        method: metric ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["body-metric", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["body-metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["body-metrics-trends"] });
      toast.success(metric ? "Updated entry" : "Logged entry");
      void navigate("/biometrics");
    },
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function include(key: Measurement, selected: boolean) {
    setIncluded((previous) => {
      const next = new Set(previous);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function submit() {
    const values = MEASUREMENTS.map((key) => {
      const active = key === "weight_kg" || included.has(key);
      return [key, active && fields[key] !== "" ? Number(fields[key]) : null];
    });
    const localTime = when.join(" ");
    const result = bodyMetricPayloadSchema.safeParse({
      ...Object.fromEntries(values),
      measured_at:
        metric && toLocalDateTimeInput(metric.measured_at) === localTime
          ? metric.measured_at
          : localDateTimeInputToIso(localTime),
    });
    if (!result.success) {
      const issues = Object.fromEntries(
        result.error.issues.map((issue) => [issue.path[0], issue.message]),
      );
      setErrors(issues);
      if (OTHER.some((key) => key in issues)) setExpanded(true);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  function control(key: Measurement) {
    return (
      <MeasurementControl
        key={key}
        name={key}
        label={labels[key]}
        value={fields[key]}
        min={key === "body_fat_percent" ? 0 : 0.1}
        max={measurementMax[key]}
        error={errors[key]}
        included={included.has(key)}
        onInclude={key !== "weight_kg" ? (selected) => include(key, selected) : undefined}
        onChange={(value) => {
          setFields((previous) => ({ ...previous, [key]: value }));
          if (key !== "weight_kg") include(key, value !== "");
        }}
      />
    );
  }

  return (
    <form
      className="@container"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Block className="grid grid-cols-2 gap-x-3 gap-y-1 py-3">
        {(["date", "time"] as const).map((type, index) => (
          <div key={type} className="min-w-0">
            <label className="field-label capitalize" htmlFor={`metric-${type}`}>
              {type === "date" ? "Date" : "Time"}
            </label>
            <Input
              id={`metric-${type}`}
              type={type}
              required
              className="min-w-0 text-base"
              value={when[index]}
              aria-invalid={Boolean(errors.measured_at)}
              aria-describedby={errors.measured_at ? "metric-date-error" : undefined}
              onChange={(event) =>
                setWhen(index === 0 ? [event.target.value, when[1]] : [when[0], event.target.value])
              }
            />
          </div>
        ))}
        {errors.measured_at && (
          <p id="metric-date-error" className="col-span-2 text-sm text-danger">
            {errors.measured_at}
          </p>
        )}
      </Block>
      <Block className="py-3">
        <h3 className="font-semibold">Daily measurements</h3>
        <p className="mb-2 text-xs text-muted">
          Only weight is required. Uncheck any reading you skipped.
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 @min-[32rem]:grid-cols-3">
          {DAILY.map(control)}
        </div>
      </Block>
      <Block>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="other-measurements"
          className="flex min-h-12 w-full items-center justify-between gap-2 text-left font-semibold"
          onClick={() => setExpanded(!expanded)}
        >
          Other measurements{otherCount > 0 && ` (${otherCount})`}
          <ChevronDown aria-hidden className={expanded ? "rotate-180" : ""} size={18} />
        </button>
        <div id="other-measurements" hidden={!expanded}>
          <p className="mb-2 text-xs text-muted">Check or adjust each measurement you took.</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pb-3 @min-[32rem]:grid-cols-3">
            {OTHER.map(control)}
          </div>
        </div>
      </Block>
      <div className="mt-3 flex gap-2">
        <Button id="save-metric-btn" type="submit" variant="primary" disabled={mutation.isPending}>
          {metric ? "Save changes" : "Log entry"}
        </Button>
        <Button onClick={() => void navigate("/biometrics")}>Cancel</Button>
      </div>
    </form>
  );
}
