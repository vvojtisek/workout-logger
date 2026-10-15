import { describe, expect, it } from "vitest";

import { EQUIPMENT_TAGS } from "../api/types";
import {
  EQUIPMENT_LABELS,
  describeEquipmentOptions,
  equipmentOptionsError,
  toggleEquipmentTag,
} from "./equipment";

describe("equipment labels", () => {
  it("names every tag", () => {
    for (const tag of EQUIPMENT_TAGS) {
      expect(EQUIPMENT_LABELS[tag]).toBeTruthy();
    }
  });
});

describe("describeEquipmentOptions", () => {
  it("is empty for an untagged exercise", () => {
    expect(describeEquipmentOptions([])).toBe("");
  });

  it("joins one option with plus signs", () => {
    expect(describeEquipmentOptions([["barbell", "rack"]])).toBe("Barbell + Rack");
  });

  it("separates alternatives with 'or'", () => {
    expect(
      describeEquipmentOptions([
        ["barbell", "bench"],
        ["bench", "dumbbell"],
      ]),
    ).toBe("Barbell + Bench, or Bench + Dumbbells");
  });
});

describe("toggleEquipmentTag", () => {
  it("adds and removes a tag in one option only", () => {
    /** @type {import("../api/types").EquipmentTag[][]} */
    const options = [["barbell"], ["band"]];
    expect(toggleEquipmentTag(options, 0, "rack")).toEqual([["barbell", "rack"], ["band"]]);
    expect(toggleEquipmentTag(options, 1, "band")).toEqual([["barbell"], []]);
    expect(options).toEqual([["barbell"], ["band"]]);
  });
});

describe("equipmentOptionsError", () => {
  it("accepts filled options and the empty list", () => {
    expect(equipmentOptionsError([])).toBeNull();
    expect(equipmentOptionsError([["band"]])).toBeNull();
  });

  it("rejects an option with nothing picked", () => {
    expect(equipmentOptionsError([["band"], []])).toMatch(/Option 2/);
  });

  it("rejects more than eight alternatives", () => {
    expect(equipmentOptionsError(Array.from({ length: 9 }, () => ["band"]))).toMatch(/8/);
  });
});
