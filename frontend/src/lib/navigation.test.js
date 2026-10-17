import { describe, expect, it } from "vitest";

import {
  DESKTOP_FOOTER_SECTIONS,
  DESKTOP_SECTIONS,
  LOG_SECTION_ID,
  MOBILE_SECTIONS,
  pageForPath,
  sectionForPath,
  sectionTarget,
} from "./navigation";

const DESKTOP = [...DESKTOP_SECTIONS, ...DESKTOP_FOOTER_SECTIONS];

/** @param {import("./navigation").NavSection[]} sections */
function allPaths(sections) {
  return sections.flatMap((section) => section.pages.map((page) => page.path)).sort();
}

describe("navigation model", () => {
  it("offers every page in both layouts, once each", () => {
    const desktop = allPaths(DESKTOP);
    const mobile = allPaths(MOBILE_SECTIONS);
    expect(mobile).toEqual(desktop);
    expect(new Set(desktop).size).toBe(desktop.length);
  });

  it("has five mobile tabs with Log in the middle", () => {
    expect(MOBILE_SECTIONS.map((section) => section.label)).toEqual([
      "Today",
      "History",
      "Log",
      "Coach",
      "More",
    ]);
    expect(MOBILE_SECTIONS[2].id).toBe(LOG_SECTION_ID);
  });

  it("matches nested routes to their page by the longest prefix", () => {
    expect(pageForPath(MOBILE_SECTIONS, "/nutrition/foods/new")?.label).toBe("Nutrition");
    expect(pageForPath(MOBILE_SECTIONS, "/plans/abc/edit")?.label).toBe("Plans");
    expect(pageForPath(MOBILE_SECTIONS, "/history/42")?.label).toBe("History");
    expect(pageForPath(MOBILE_SECTIONS, "/planner")).toBeNull();
  });

  it("puts the live workout in the section that starts workouts", () => {
    expect(sectionForPath(MOBILE_SECTIONS, "/workout")?.label).toBe("Log");
    expect(sectionForPath(DESKTOP, "/workout")?.label).toBe("Active Workout");
  });

  it("groups pages differently on desktop and mobile", () => {
    expect(sectionForPath(DESKTOP, "/exercises/1")?.label).toBe("Exercise Catalogue");
    expect(sectionForPath(MOBILE_SECTIONS, "/exercises/1")?.label).toBe("Coach");
    expect(sectionForPath(MOBILE_SECTIONS, "/tokens/new")?.label).toBe("More");
    expect(sectionForPath(DESKTOP, "/locations")?.label).toBe("Exercise Catalogue");
    expect(sectionForPath(MOBILE_SECTIONS, "/locations")?.label).toBe("Coach");
    expect(sectionForPath(DESKTOP, "/schedule")?.label).toBe("Calendar");
    expect(sectionForPath(MOBILE_SECTIONS, "/schedule")?.label).toBe("Coach");
    expect(sectionForPath(MOBILE_SECTIONS, "/sleep/new")?.label).toBe("More");
    expect(sectionForPath(MOBILE_SECTIONS, "/today")?.label).toBe("Today");
  });

  it("returns to a live session from the workout section", () => {
    const workout = DESKTOP_SECTIONS.find((section) => section.id === "workout");
    if (!workout) throw new Error("no workout section");
    expect(sectionTarget(workout, false)).toBe("/log/new");
    expect(sectionTarget(workout, true)).toBe("/workout");
    expect(sectionTarget(MOBILE_SECTIONS[3], true)).toBe("/plans");
    expect(sectionTarget(MOBILE_SECTIONS[0], true)).toBe("/today");
  });
});
