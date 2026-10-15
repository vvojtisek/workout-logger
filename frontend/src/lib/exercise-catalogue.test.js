import { describe, expect, it } from "vitest";

import { exerciseListPath, fetchCatalogueNames } from "./exercise-catalogue";

describe("exerciseListPath", () => {
  it("lists the first page without a search", () => {
    expect(exerciseListPath("   ")).toBe("/exercises?limit=100&offset=0");
  });

  it("encodes a trimmed search term", () => {
    expect(exerciseListPath(" dead bug&x ", 100)).toBe(
      "/exercises?limit=100&offset=100&q=dead+bug%26x",
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
