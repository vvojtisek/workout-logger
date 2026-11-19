import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import {
  KIND_LABELS,
  SEVERITY_LABELS,
  draftToProfile,
  emptyConstraint,
  profileToDraft,
} from "@/lib/athlete-profile";
import type {
  AthleteProfile,
  ConstraintDraft,
  ConstraintKind,
  ConstraintSeverity,
  ProfileDraft,
} from "@/lib/athlete-profile";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/ui/Toast";
import { Button, Input, EntryForm } from "@/ui";

const PROFILE_KEY = ["athlete-profile"] as const;

/** What an assistant reads before it plans: goals, physical limits and the
 * dietary rules the server checks every meal plan against. */
export function AthleteProfileSection() {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => apiFetch<AthleteProfile>("/profile"),
  });
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && draft === null) setDraft(profileToDraft(profile.data));
  }, [profile.data, draft]);

  const save = useMutation({
    mutationFn: (body: Omit<AthleteProfile, "updated_at">) =>
      apiFetch<AthleteProfile>("/profile", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PROFILE_KEY, saved);
      setDraft(profileToDraft(saved));
      toast.success("Coach profile saved");
    },
    onError: (err) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function updateRow(key: string, patch: Partial<ConstraintDraft>) {
    if (!draft) return;
    setDraft({
      ...draft,
      constraints: draft.constraints.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    });
  }

  function submit() {
    if (!draft) return;
    const result = draftToProfile(draft);
    setError(result.error);
    if (result.profile) save.mutate(result.profile);
  }

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-muted">Coach profile</h2>
      <EntryForm onSave={submit} className="block-flat flex flex-col gap-4 py-4">
        <p className="text-sm text-muted">
          An assistant connected over MCP reads this first. Severe and strict food rules are checked by the
          server: a meal plan with a blocked ingredient is refused.
        </p>
        {profile.isError ? <p className="text-sm text-danger">Failed to load: {errorMessage(profile.error)}</p> : null}
        {draft ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="profile-name">
                  Name the coach uses
                </label>
                <Input
                  id="profile-name"
                  maxLength={100}
                  value={draft.displayName}
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="profile-birth-year">
                  Birth year
                </label>
                <Input
                  id="profile-birth-year"
                  inputMode="numeric"
                  value={draft.birthYear}
                  onChange={(event) => setDraft({ ...draft, birthYear: event.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="profile-goals">
                Goals, one per line
              </label>
              <textarea
                id="profile-goals"
                className="input"
                rows={3}
                value={draft.goals}
                onChange={(event) => setDraft({ ...draft, goals: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="profile-physical">
                Physical limits, one per line
              </label>
              <textarea
                id="profile-physical"
                className="input"
                rows={2}
                value={draft.physical}
                onChange={(event) => setDraft({ ...draft, physical: event.target.value })}
              />
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="field-label">Food rules</legend>
              {draft.constraints.map((row, index) => (
                <div
                  key={row.key}
                  data-testid="profile-constraint"
                  className="grid grid-cols-1 gap-2 border-b border-line-muted pb-3 sm:grid-cols-[2fr_1fr_1fr]"
                >
                  <Input
                    aria-label={`Food rule ${index + 1}: what to avoid`}
                    placeholder="e.g. gluten"
                    maxLength={100}
                    value={row.item}
                    onChange={(event) => updateRow(row.key, { item: event.target.value })}
                  />
                  <select
                    aria-label={`Food rule ${index + 1}: kind`}
                    className="input"
                    value={row.kind}
                    onChange={(event) => updateRow(row.key, { kind: event.target.value as ConstraintKind })}
                  >
                    {Object.entries(KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Food rule ${index + 1}: severity`}
                    className="input"
                    value={row.severity}
                    onChange={(event) => updateRow(row.key, { severity: event.target.value as ConstraintSeverity })}
                  >
                    {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="sm:col-span-2"
                    aria-label={`Food rule ${index + 1}: blocked words`}
                    placeholder="Blocked words, comma separated (blank: the rule's name)"
                    disabled={row.adviceOnly || row.severity === "preference"}
                    value={row.terms}
                    onChange={(event) => updateRow(row.key, { terms: event.target.value })}
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={row.adviceOnly}
                      onChange={(event) => updateRow(row.key, { adviceOnly: event.target.checked })}
                    />
                    Advice only
                  </label>
                  <Input
                    className="sm:col-span-2"
                    aria-label={`Food rule ${index + 1}: note`}
                    placeholder="Note, e.g. raw is fine"
                    maxLength={200}
                    value={row.note}
                    onChange={(event) => updateRow(row.key, { note: event.target.value })}
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setDraft({ ...draft, constraints: draft.constraints.filter((item) => item.key !== row.key) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button onClick={() => setDraft({ ...draft, constraints: [...draft.constraints, emptyConstraint()] })}>
                  Add food rule
                </Button>
              </div>
            </fieldset>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button id="save-profile-btn" variant="primary" disabled={save.isPending} type="submit">
                Save coach profile
              </Button>
              {profile.data?.updated_at ? (
                <span className="text-xs text-muted">Last saved {formatDateTime(profile.data.updated_at)}</span>
              ) : null}
            </div>
          </>
        ) : null}
      </EntryForm>
    </div>
  );
}
