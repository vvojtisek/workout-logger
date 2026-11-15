import { describe, expect, it } from "vitest";

import { draftToProfile, emptyConstraint, profileToDraft } from "./athlete-profile";

/** @type {import("./athlete-profile").AthleteProfile} */
const profile = {
  display_name: "Vlad",
  birth_year: 1973,
  longevity_goals: ["Keep VO2max", "Stay strong"],
  physical_constraints: ["Left knee: no deep flexion"],
  dietary_constraints: [
    { item: "fish and seafood", kind: "allergy", severity: "severe", note: null, match_terms: ["fish", "salmon"] },
    { item: "gluten", kind: "intolerance", severity: "strict", note: null, match_terms: null },
    { item: "cooked dill", kind: "exclusion", severity: "strict", note: "raw is fine", match_terms: [] },
  ],
};

describe("athlete profile form", () => {
  it("round-trips every field, including advice-only rules", () => {
    const result = draftToProfile(profileToDraft(profile));
    expect(result.error).toBeNull();
    expect(result.profile).toEqual({ ...profile });
  });

  it("drops blank rows and rejects a bad birth year", () => {
    const draft = profileToDraft(profile);
    draft.constraints.push(emptyConstraint());
    expect(draftToProfile(draft).profile?.dietary_constraints).toHaveLength(3);
    expect(draftToProfile({ ...draft, birthYear: "73" }).error).toMatch(/Birth year/);
  });

  it("lower-cases blocked words", () => {
    const draft = profileToDraft(profile);
    draft.constraints[0].terms = "Fish, Tuna ,";
    expect(draftToProfile(draft).profile?.dietary_constraints[0].match_terms).toEqual(["fish", "tuna"]);
  });
});
