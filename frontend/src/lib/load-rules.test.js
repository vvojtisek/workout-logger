import { describe, expect, it } from "vitest";

import { formatVolumeKg, loadNotes, loadRuleText, repsHint, repsText, weightHint } from "./load-rules";

describe("load rule labels", () => {
  it("says the typed weight is one dumbbell and how volume counts it", () => {
    expect(weightHint({ equipment_load_mode: "pair_db" })).toBe("Input: 1x DB (Vol: 2x)");
    expect(weightHint({ equipment_load_mode: "single_db" })).toBe("Input: 1x DB");
    expect(weightHint({ equipment_load_mode: "standard" })).toBeNull();
    expect(weightHint({})).toBeNull();
  });

  it("marks reps per side only for unilateral exercises", () => {
    expect(repsHint({ is_unilateral: true })).toBe("per side");
    expect(repsHint({ is_unilateral: false })).toBeNull();
    expect(repsText("8, 8", { is_unilateral: true })).toBe("8, 8 reps per side");
    expect(repsText("10", {})).toBe("10 reps");
  });

  it("formats volume as whole kilograms with a space between thousands", () => {
    expect(formatVolumeKg(1440)).toBe("1 440 kg");
    expect(formatVolumeKg(399.6)).toBe("400 kg");
  });
});

describe("loadRuleText", () => {
  it("explains a non-default rule in one line", () => {
    expect(loadRuleText({ equipment_load_mode: "pair_db", is_unilateral: true })).toBe(
      "Type one dumbbell; volume counts both. Reps are per side; volume counts both sides.",
    );
    expect(loadRuleText({ equipment_load_mode: "standard", is_unilateral: false })).toBeNull();
  });
});

describe("loadNotes", () => {
  it("marks per-side reps and per-dumbbell weight after a logged exercise", () => {
    expect(loadNotes({ equipment_load_mode: "pair_db", is_unilateral: true })).toBe(
      " (per side, per dumbbell)",
    );
    expect(loadNotes({ equipment_load_mode: "single_db", is_unilateral: true })).toBe(" (per side)");
    expect(loadNotes({})).toBe("");
  });
});
