import { describe, expect, it } from "vitest";

import {
  DESKTOP_FOOTER_SECTIONS,
  DESKTOP_SECTIONS,
  LOG_SECTION_ID,
  MOBILE_SECTIONS,
  pageForPath,
  sectionForPath,
} from "./navigation";

const DESKTOP = [...DESKTOP_SECTIONS, ...DESKTOP_FOOTER_SECTIONS];

describe("navigation model", () => {
  it("keeps the central Log action and the same Training section on both layouts", () => {
    expect(MOBILE_SECTIONS.map((section) => section.label)).toEqual([
      "Today",
      "Training",
      "Log",
      "Nutrition",
      "More",
    ]);
    expect(MOBILE_SECTIONS[2].id).toBe(LOG_SECTION_ID);
    expect(MOBILE_SECTIONS[1]).toBe(DESKTOP_SECTIONS[1]);
  });

  it.each([{ sections: DESKTOP }, { sections: MOBILE_SECTIONS }])("assigns existing deep links to their new training tabs", ({ sections }) => {
    for (const [path, tab] of [
      ["/training", "Overview"],
      ["/workout", "Overview"],
      ["/activity/quick", "Overview"],
      ["/plans/abc/edit", "Planning"],
      ["/programs/abc/edit", "Planning"],
      ["/schedule", "Planning"],
      ["/exercises/abc/edit", "Library"],
      ["/locations", "Library"],
      ["/training-load", "Trends"],
      ["/history/42", "Entries"],
    ]) {
      expect(sectionForPath(sections, path)?.label).toBe("Training");
      expect(pageForPath(sections, path)?.label).toBe(tab);
    }
    expect(pageForPath(sections, "/planner")).toBeNull();
  });
});
