import { describe, expect, it } from "vitest";

import { FULL_BLEED, isFullBleed } from "./MasterDetail";

describe("isFullBleed", () => {
  it("is true only for the full-bleed route handle", () => {
    expect(isFullBleed(FULL_BLEED)).toBe(true);
    expect(isFullBleed(undefined)).toBe(false);
    expect(isFullBleed(null)).toBe(false);
    expect(isFullBleed({ fullBleed: "yes" })).toBe(false);
    expect(isFullBleed({})).toBe(false);
  });
});
