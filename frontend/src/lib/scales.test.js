import { describe, expect, it } from "vitest";

import {
  EFFORT_SCALE,
  FEELING_SCALE,
  SLEEP_QUALITY_SCALE,
  rirMeaning,
  scaleLabel,
  scaleOptionText,
  scaleText,
} from "./scales";

describe("SLEEP_QUALITY_SCALE", () => {
  it("names every score from 1 to 5", () => {
    expect([1, 2, 3, 4, 5].map((score) => scaleLabel(SLEEP_QUALITY_SCALE, score))).toEqual([
      "Very poor",
      "Poor",
      "Fair",
      "Good",
      "Excellent",
    ]);
  });
});

describe("FEELING_SCALE", () => {
  it("names every score from 1 to 5", () => {
    expect([1, 2, 3, 4, 5].map((score) => scaleLabel(FEELING_SCALE, score))).toEqual([
      "Very poor",
      "Poor",
      "OK",
      "Good",
      "Great",
    ]);
  });
});

describe("EFFORT_SCALE", () => {
  it("names every effort from 1 to 10", () => {
    const labels = Array.from({ length: 10 }, (_, index) => scaleLabel(EFFORT_SCALE, index + 1));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(labels[0]).toBe("Very easy");
    expect(labels[4]).toBe("Hard");
    expect(labels[9]).toBe("Maximal");
  });
});

describe("scaleText", () => {
  it("keeps the number and adds its meaning", () => {
    expect(scaleText(SLEEP_QUALITY_SCALE, 4)).toBe("4/5 (Good)");
    expect(scaleText(EFFORT_SCALE, 7)).toBe("7/10 (Very hard)");
  });

  it("rounds an average to the nearest label", () => {
    expect(scaleText(SLEEP_QUALITY_SCALE, 3.6)).toBe("3.6/5 (about Good)");
  });

  it("does not invent a label for missing or out-of-range values", () => {
    expect(scaleText(SLEEP_QUALITY_SCALE, null)).toBe("");
    expect(scaleText(SLEEP_QUALITY_SCALE, undefined)).toBe("");
    expect(scaleText(SLEEP_QUALITY_SCALE, 0)).toBe("0/5");
    expect(scaleText(SLEEP_QUALITY_SCALE, 9)).toBe("9/5");
    expect(scaleLabel(SLEEP_QUALITY_SCALE, 6)).toBe("");
  });
});

describe("scaleOptionText", () => {
  it("shows the number and its meaning in a picker", () => {
    expect(scaleOptionText(SLEEP_QUALITY_SCALE, 1)).toBe("1 · Very poor");
  });
});

describe("rirMeaning", () => {
  it("says how many reps were left", () => {
    expect(rirMeaning(0)).toBe("no reps left (failure)");
    expect(rirMeaning(1)).toBe("1 more rep possible");
    expect(rirMeaning(3)).toBe("3 more reps possible");
    expect(rirMeaning(null)).toBe("");
  });
});
