// The athlete profile the coach reads first: goals, limits and the dietary
// rules the server enforces on every meal plan. Form values <-> API body.

export type ConstraintKind = "allergy" | "intolerance" | "exclusion";
export type ConstraintSeverity = "severe" | "strict" | "preference";

export interface DietaryConstraint {
  item: string;
  kind: ConstraintKind;
  severity: ConstraintSeverity;
  note: string | null;
  /** null: the item itself is blocked; []: advice only, never checked. */
  match_terms: string[] | null;
}

export interface AthleteProfile {
  display_name: string | null;
  birth_year: number | null;
  longevity_goals: string[];
  dietary_constraints: DietaryConstraint[];
  physical_constraints: string[];
  updated_at?: string | null;
}

export interface ConstraintDraft {
  key: string;
  item: string;
  kind: ConstraintKind;
  severity: ConstraintSeverity;
  note: string;
  /** Comma-separated words; blank blocks the item itself. */
  terms: string;
  adviceOnly: boolean;
}

export interface ProfileDraft {
  displayName: string;
  birthYear: string;
  goals: string;
  physical: string;
  constraints: ConstraintDraft[];
}

export const KIND_LABELS: Record<ConstraintKind, string> = {
  allergy: "Allergy",
  intolerance: "Intolerance",
  exclusion: "Never eat",
};

export const SEVERITY_LABELS: Record<ConstraintSeverity, string> = {
  severe: "Severe (blocked)",
  strict: "Strict (blocked)",
  preference: "Preference (advice)",
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function emptyConstraint(): ConstraintDraft {
  return {
    key: crypto.randomUUID(),
    item: "",
    kind: "exclusion",
    severity: "strict",
    note: "",
    terms: "",
    adviceOnly: false,
  };
}

export function profileToDraft(profile: AthleteProfile): ProfileDraft {
  return {
    displayName: profile.display_name ?? "",
    birthYear: profile.birth_year == null ? "" : String(profile.birth_year),
    goals: profile.longevity_goals.join("\n"),
    physical: profile.physical_constraints.join("\n"),
    constraints: profile.dietary_constraints.map((constraint) => ({
      key: crypto.randomUUID(),
      item: constraint.item,
      kind: constraint.kind,
      severity: constraint.severity,
      note: constraint.note ?? "",
      terms: (constraint.match_terms ?? []).join(", "),
      adviceOnly: constraint.match_terms !== null && constraint.match_terms.length === 0,
    })),
  };
}

/** The PUT body, or the first problem to show. Rows with no item are dropped. */
export function draftToProfile(
  draft: ProfileDraft,
): { profile: Omit<AthleteProfile, "updated_at">; error: null } | { profile: null; error: string } {
  let birthYear: number | null = null;
  if (draft.birthYear.trim()) {
    birthYear = Number(draft.birthYear);
    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100) {
      return { profile: null, error: "Birth year must be a year such as 1973." };
    }
  }
  const constraints: DietaryConstraint[] = [];
  for (const row of draft.constraints) {
    const item = row.item.trim();
    if (!item) continue;
    const terms = row.terms
      .split(",")
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    if (terms.some((term) => term.length > 60)) {
      return { profile: null, error: `${item}: each blocked word must be at most 60 characters.` };
    }
    constraints.push({
      item,
      kind: row.kind,
      severity: row.severity,
      note: row.note.trim() || null,
      match_terms: row.adviceOnly ? [] : terms.length > 0 ? terms : null,
    });
  }
  return {
    profile: {
      display_name: draft.displayName.trim() || null,
      birth_year: birthYear,
      longevity_goals: lines(draft.goals),
      dietary_constraints: constraints,
      physical_constraints: lines(draft.physical),
    },
    error: null,
  };
}
