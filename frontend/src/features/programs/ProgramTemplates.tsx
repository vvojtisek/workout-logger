import { useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type {
  ProgramTemplate,
  ProgramTemplateInstallResult,
} from "@/api/types";
import {
  WEEKDAY_LABELS,
  nextMondayIso,
  toggleWeekday,
} from "@/lib/program-templates";
import { toast } from "@/ui/Toast";
import { Button, Card, Input } from "@/ui";
import { formatDate } from "@/lib/format";

function TemplateCard({
  template,
  onInstalled,
}: {
  template: ProgramTemplate;
  onInstalled: () => void;
}) {
  const [startDate, setStartDate] = useState(() => nextMondayIso(new Date()));
  const [weekdays, setWeekdays] = useState<number[]>(
    template.default_weekdays ?? [],
  );
  const [saving, setSaving] = useState(false);
  const isSequence = template.schedule_type === "sequence";
  const maxPerWeek = template.max_sessions_per_week ?? 7;
  const idPrefix = `template-${template.key}`;

  async function install() {
    setSaving(true);
    try {
      const result = await apiFetch<ProgramTemplateInstallResult>(
        `/program-templates/${template.key}/install`,
        {
          method: "POST",
          body: JSON.stringify({
            start_date: startDate,
            weekdays: isSequence ? weekdays : null,
          }),
        },
      );
      toast.success(
        `Added "${result.program.name}": ${result.scheduled_count} sessions from ${formatDate(result.program.start_date)}`,
      );
      onInstalled();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li aria-label={template.name}>
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-medium">{template.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {template.location} &middot; {template.session_count} sessions
          </p>
          <p className="mt-1 text-sm">{template.summary}</p>
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-start`}>
            {isSequence
              ? "First session on or after"
              : "Start week (from the Monday on or after)"}
          </label>
          <Input
            id={`${idPrefix}-start`}
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        {isSequence ? (
          <fieldset>
            <legend className="field-label">
              Training days (up to {maxPerWeek} a week)
            </legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, weekday) => (
                <Button
                  key={label}
                  aria-pressed={weekdays.includes(weekday)}
                  variant={weekdays.includes(weekday) ? "primary" : "secondary"}
                  onClick={() =>
                    setWeekdays((current) =>
                      toggleWeekday(current, weekday, maxPerWeek),
                    )
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-xs text-muted">
            Monday, Tuesday and Wednesday each week.
          </p>
        )}
        <div>
          <Button
            variant="primary"
            disabled={
              saving || !startDate || (isSequence && weekdays.length === 0)
            }
            onClick={() => void install()}
          >
            Start this program
          </Button>
        </div>
      </Card>
    </li>
  );
}

export function ProgramTemplates({ onInstalled }: { onInstalled: () => void }) {
  const [templates, setTemplates] = useState<ProgramTemplate[]>([]);

  useEffect(() => {
    apiFetch<{ items: ProgramTemplate[] }>("/program-templates")
      .then((data) => setTemplates(data.items))
      .catch(() => undefined);
  }, []);

  if (templates.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="program-templates-heading">
      <h3 id="program-templates-heading" className="mb-1 text-lg font-semibold">
        Ready-made programs
      </h3>
      <p className="mb-3 text-sm text-muted">
        Adds the workout plans to your Plans and every session to your calendar,
        each with that session's instructions.
      </p>
      <ul id="program-templates" className="flex flex-col gap-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.key}
            template={template}
            onInstalled={onInstalled}
          />
        ))}
      </ul>
    </section>
  );
}
