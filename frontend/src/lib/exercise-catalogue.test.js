import { describe, expect, it } from "vitest";

import {
  exerciseListPath,
  fetchCatalogueExercises,
  fetchCatalogueNames,
} from "./exercise-catalogue";

describe("exerciseListPath", () => {
  it("lists the first page without a search", () => {
    expect(exerciseListPath("   ")).toBe("/exercises?limit=100&offset=0");
  });

  it("encodes a trimmed search term", () => {
    expect(exerciseListPath(" dead bug&x ", 100)).toBe(
      "/exercises?limit=100&offset=100&q=dead+bug%26x",
    );
  });

  it("filters by a location when one is picked", () => {
    expect(exerciseListPath("", 0, "loc-1")).toBe(
      "/exercises?limit=100&offset=0&location_id=loc-1",
    );
  });

  it("filters by a movement pattern", () => {
    expect(exerciseListPath("", 0, "", "horizontal_push")).toBe(
      "/exercises?limit=100&offset=0&movement_pattern=horizontal_push",
    );
  });
});

describe("fetchCatalogueNames", () => {
  it("pages through the whole catalogue", async () => {
    const all = Array.from({ length: 181 }, (_, index) => ({ name: `Exercise ${index}` }));
    /** @type {string[]} */
    const paths = [];
    const names = await fetchCatalogueNames(async (path) => {
      paths.push(path);
      const offset = Number(/offset=(\d+)/.exec(path)?.[1]);
      return { items: all.slice(offset, offset + 100), total: all.length };
    });

    expect(paths).toEqual(["/exercises?limit=100&offset=0", "/exercises?limit=100&offset=100"]);
    expect(names).toHaveLength(181);
    expect(names[180]).toBe("Exercise 180");
  });

  it("stops on an empty page even if the total is stale", async () => {
    const names = await fetchCatalogueNames(async () => ({ items: [], total: 5 }));
    expect(names).toEqual([]);
  });
});

describe("fetchCatalogueExercises", () => {
  it("pages through exercise metadata for plan summaries", async () => {
    const all = Array.from({ length: 121 }, (_, index) => ({
      id: String(index),
      name: `Lift ${index}`,
      aliases: [],
      media_url: null,
      primary_muscles: [],
      secondary_muscles: [],
      instructions: [],
      equipment: null,
      equipment_any_of: [],
      safety_notes: null,
      progression_increment_kg: null,
      equipment_load_mode: /** @type {"standard"} */ ("standard"),
      movement_pattern: null,
      is_unilateral: false,
      created_at: "",
      updated_at: "",
    }));
    /** @type {string[]} */
    const paths = [];
    const exercises = await fetchCatalogueExercises(async (path) => {
      paths.push(path);
      const offset = Number(/offset=(\d+)/.exec(path)?.[1]);
      const items = all.slice(offset, offset + 100);
      return { items, total: all.length, limit: 100, offset };
    });

    expect(paths).toEqual(["/exercises?limit=100&offset=0", "/exercises?limit=100&offset=100"]);
    expect(exercises).toHaveLength(121);
    expect(exercises[120]?.name).toBe("Lift 120");
  });
});
