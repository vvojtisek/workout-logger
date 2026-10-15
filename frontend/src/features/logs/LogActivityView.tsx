import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import { ACTIVITY_TYPES, activityLabel } from "@/lib/activity";
import type { ActivityType } from "@/lib/activity";
import { toast } from "@/ui/Toast";
import { Button, Card, Input, PageHeading } from "@/ui";

// Borg CR-10 anchors, so the number means the same thing session to session.
const EFFORT_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Moderate",
  4: "Somewhat hard",
  5: "Hard",
  7: "Very hard",
  10: "Maximal",
};

function localNow(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function LogActivityView() {
  const navigate = useNavigate();
  const [activityType, setActivityType] = useState<ActivityType>("ice_hockey");
  const [performedAt, setPerformedAt] = useState(localNow);
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
    const payload = {
      activity_type: activityType,
      performed_at: new Date(performedAt).toISOString(),
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
                type="datetime-local"
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
              <select
                id="activity-effort"
                className="input"
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
              >
                <option value="">Not rated</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={String(value)}>
                    {EFFORT_LABELS[value] ? `${value} · ${EFFORT_LABELS[value]}` : String(value)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="activity-feeling">
                How you felt (1-5)
              </label>
              <select
                id="activity-feeling"
                className="input"
                value={feeling}
                onChange={(event) => setFeeling(event.target.value)}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
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
