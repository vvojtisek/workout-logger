import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { BodyMetric } from "@/api/types";
import { bodyMetricPayloadSchema } from "@/lib/body-metric-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const CIRCUMFERENCE_FIELDS = [
  { key: "neck_cm", label: "Neck (cm)" },
  { key: "chest_cm", label: "Chest (cm)" },
  { key: "waist_cm", label: "Waist (cm)" },
  { key: "hips_cm", label: "Hips (cm)" },
  { key: "biceps_cm", label: "Biceps (cm)" },
  { key: "forearms_cm", label: "Forearms (cm)" },
  { key: "thighs_cm", label: "Thighs (cm)" },
  { key: "calves_cm", label: "Calves (cm)" },
] as const;

type FieldState = Record<string, string>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function nowAsDatetimeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyFields(): FieldState {
  return {
    measured_at: nowAsDatetimeLocal(),
    weight_kg: "",
    body_fat_percent: "",
    neck_cm: "",
    chest_cm: "",
    waist_cm: "",
    hips_cm: "",
    biceps_cm: "",
    forearms_cm: "",
    thighs_cm: "",
    calves_cm: "",
  };
}

function fieldsFromMetric(metric: BodyMetric): FieldState {
  return {
    measured_at: toDatetimeLocal(metric.measured_at),
    weight_kg: String(metric.weight_kg),
    body_fat_percent: metric.body_fat_percent != null ? String(metric.body_fat_percent) : "",
    neck_cm: metric.neck_cm != null ? String(metric.neck_cm) : "",
    chest_cm: metric.chest_cm != null ? String(metric.chest_cm) : "",
    waist_cm: metric.waist_cm != null ? String(metric.waist_cm) : "",
    hips_cm: metric.hips_cm != null ? String(metric.hips_cm) : "",
    biceps_cm: metric.biceps_cm != null ? String(metric.biceps_cm) : "",
    forearms_cm: metric.forearms_cm != null ? String(metric.forearms_cm) : "",
    thighs_cm: metric.thighs_cm != null ? String(metric.thighs_cm) : "",
    calves_cm: metric.calves_cm != null ? String(metric.calves_cm) : "",
  };
}

function buildPayload(fields: FieldState) {
  const num = (key: string) => (fields[key].trim() ? Number.parseFloat(fields[key]) : null);
  return {
    measured_at: fields.measured_at ? new Date(fields.measured_at).toISOString() : "",
    weight_kg: num("weight_kg") ?? Number.NaN,
    body_fat_percent: num("body_fat_percent"),
    neck_cm: num("neck_cm"),
    chest_cm: num("chest_cm"),
    waist_cm: num("waist_cm"),
    hips_cm: num("hips_cm"),
    biceps_cm: num("biceps_cm"),
    forearms_cm: num("forearms_cm"),
    thighs_cm: num("thighs_cm"),
    calves_cm: num("calves_cm"),
  };
}

export function BiometricEntryForm() {
  const { metricId } = useParams<{ metricId: string }>();
  const isEditing = Boolean(metricId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<FieldState>(emptyFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededMetricId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["body-metric", metricId],
    queryFn: () => apiFetch<BodyMetric>(`/body-metrics/${metricId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededMetricId.current === existing.id) return;
    seededMetricId.current = existing.id;
    setFields(fieldsFromMetric(existing));
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<BodyMetric>(`/body-metrics/${metricId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<BodyMetric>("/body-metrics", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["body-metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["body-metrics-trends"] });
      toast.success(isEditing ? "Updated entry" : "Logged entry");
      void navigate("/biometrics");
    },
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function update(key: string, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const payload = buildPayload(fields);
    const result = bodyMetricPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  if (isEditing && isLoading) {
    return (
      <section id="biometric-form-view">
        <PageHeading>{isEditing ? "Edit Entry" : "Log Biometrics"}</PageHeading>
        <p className="text-sm text-muted">Loading entry…</p>
      </section>
    );
  }

  return (
    <section id="biometric-form-view">
      <PageHeading>{isEditing ? "Edit Entry" : "Log Biometrics"}</PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <label className="field-label" htmlFor="metric-measured-at">
            Date and time
          </label>
          <Input
            id="metric-measured-at"
            type="datetime-local"
            value={fields.measured_at}
            onChange={(event) => update("measured_at", event.target.value)}
          />
          {errors.measured_at ? (
            <p className="mt-1 text-sm text-danger">{errors.measured_at}</p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="metric-weight">
              Weight (kg)
            </label>
            <Input
              id="metric-weight"
              type="number"
              step="0.1"
              value={fields.weight_kg}
              onChange={(event) => update("weight_kg", event.target.value)}
            />
            {errors.weight_kg ? (
              <p className="mt-1 text-sm text-danger">{errors.weight_kg}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="metric-body-fat">
              Body fat (%, optional)
            </label>
            <Input
              id="metric-body-fat"
              type="number"
              step="0.1"
              value={fields.body_fat_percent}
              onChange={(event) => update("body_fat_percent", event.target.value)}
            />
            {errors.body_fat_percent ? (
              <p className="mt-1 text-sm text-danger">{errors.body_fat_percent}</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Measurements (optional)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {CIRCUMFERENCE_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="field-label" htmlFor={`metric-${field.key}`}>
                  {field.label}
                </label>
                <Input
                  id={`metric-${field.key}`}
                  type="number"
                  step="0.1"
                  value={fields[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                />
                {errors[field.key] ? (
                  <p className="mt-1 text-sm text-danger">{errors[field.key]}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-metric-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Log entry"}
        </Button>
        <Button onClick={() => void navigate("/biometrics")}>Cancel</Button>
      </div>
    </section>
  );
}
