import { describe, expect, it } from "vitest";

import { catalogAddPath, catalogSearchPath, withAddedFood } from "./food-catalog";

/** @param {string} id @param {string} name */
function food(id, name) {
  return /** @type {import("@/api/types").Food} */ ({ id, name });
}

describe("catalogSearchPath", () => {
  it("waits for two characters", () => {
    expect(catalogSearchPath(" m ")).toBeNull();
  });

  it("encodes a trimmed search term", () => {
    expect(catalogSearchPath(" vločky ovesné ")).toBe(
      "/food-catalog?q=vlo%C4%8Dky+ovesn%C3%A9&limit=20",
    );
  });
});

describe("catalogAddPath", () => {
  it("escapes the catalogue id", () => {
    expect(catalogAddPath("ndb-0062")).toBe("/food-catalog/ndb-0062/add");
    expect(catalogAddPath("a/b")).toBe("/food-catalog/a%2Fb/add");
  });
});

describe("withAddedFood", () => {
  const list = { items: [food("1", "Banán"), food("2", "Mrkev")], total: 2, limit: 100, offset: 0 };

  it("inserts the new food in name order", () => {
    const next = withAddedFood(list, food("3", "Jablko"));
    expect(next?.items.map((item) => item.name)).toEqual(["Banán", "Jablko", "Mrkev"]);
    expect(next?.total).toBe(3);
  });

  it("leaves the list alone when the food is already there", () => {
    expect(withAddedFood(list, food("2", "Mrkev"))).toBe(list);
  });

  it("does nothing before the list has loaded", () => {
    expect(withAddedFood(undefined, food("3", "Jablko"))).toBeUndefined();
  });
});
