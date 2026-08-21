import { describe, expect, it } from "vitest";

import { parseRepsPerSet } from "../app/static/workout-utils.js";

describe("parseRepsPerSet", () => {
  it("normalizes comma-separated set repetitions", () => {
    expect(parseRepsPerSet("10, 8,, 6")).toEqual([10, 8, 6]);
  });
});
