import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import { ACTIVITY_TYPES, activityLabel } from "@/lib/activity";
import type { ActivityType } from "@/lib/activity";
import { localDateTimeInputToIso, nowAsLocalDateTimeInput } from "@/lib/date-time-inputs";
import { toast } from "@/ui/Toast";
import { Button, Card, Input, PageHeading } from "@/ui";
import { EFFORT_SCALE, FEELING_SCALE } from "@/lib/scales";
import { ScaleSelect } from "@/ui/ScaleSelect";

export function LogActivityView() {
  const navigate = useNavigate();
  const [activityType, setActivityType] = useState<ActivityType>("ice_hockey");
  const [performedAt, setPerformedAt] = useState(nowAsLocalDateTimeInput);
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [effort, setEffort] = useState("");
  const [feeling, setFeeling] = useState("3");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const showDistance = activityType !== "ice_hockey";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const performedAtIso = localDateTimeInputToIso(performedAt);
    if (!performedAtIso) {
      setSaving(false);
      toast.error("Enter a valid date and time as YYYY-MM-DD HH:mm.");
      return;
    }
    const payload = {
      activity_type: activityType,
      performed_at: performedAtIso,
      total_time_minutes: Number.parseInt(duration, 10),
      distance_km: showDistance && distance ? Number.parseFloat(distance) : null,
      effort_rpe: effort ? Number.parseInt(effort, 10) : null,
      overall_feeling: Number.parseInt(feeling, 10),
      notes: notes.trim() || null,
      exercises: [],
    };
    try {
      await apiFetch("/logs", { method: "POST", body: JSON.stringify(payload) });
      toast.success(`${activityLabel(activityType)} saved`);
      void navigate("/history");
    } catch (err) {
      toast.error(`Failed to save activity: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="log-activity-view">
      <PageHeading hint="Hockey, a swim, a ride or a hike: anything that isn't a gym workout.">
        Log Activity
      </PageHeading>
      <form onSubmit={submit}>
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <label className="field-label" htmlFor="activity-type">
              Activity
            </label>
            <select
              id="activity-type"
              className="input"
              value={activityType}
              onChange={(event) => setActivityType(event.target.value as ActivityType)}
            >
              {ACTIVITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {activityLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="activity-performed-at">
                Started at
              </label>
              <Input
                id="activity-performed-at"
                type="text"
                inputMode="text"
                placeholder="YYYY-MM-DD HH:mm"
                maxLength={16}
                pattern="[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}"
                required
                value={performedAt}
                onChange={(event) => setPerformedAt(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="activity-duration">
                Duration (minutes)
              </label>
              <Input
                id="activity-duration"
                type="number"
                inputMode="numeric"
                min="1"
                max="1440"
                required
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
            {showDistance ? (
              <div>
                <label className="field-label" htmlFor="activity-distance">
                  Distance (km, optional)
                </label>
                <Input
                  id="activity-distance"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                />
              </div>
            ) : null}
            <div>
              <label className="field-label" htmlFor="activity-effort">
                Effort (optional)
              </label>
              <ScaleSelect
                id="activity-effort"
                scale={EFFORT_SCALE}
                optional
                value={effort}
                onChange={setEffort}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="activity-feeling">
                How you felt
              </label>
              <ScaleSelect
                id="activity-feeling"
                scale={FEELING_SCALE}
                value={feeling}
                onChange={setFeeling}
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="activity-notes">
              Notes (optional)
            </label>
            <textarea
              id="activity-notes"
              className="input"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              Save activity
            </Button>
            <Button onClick={() => void navigate("/history")}>Cancel</Button>
          </div>
        </Card>
      </form>
    </section>
  );
}
