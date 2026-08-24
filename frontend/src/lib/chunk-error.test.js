import { describe, expect, it } from "vitest";

import { isChunkLoadError, shouldRetryChunkReload } from "./chunk-error";

describe("isChunkLoadError", () => {
  it("matches Chrome/Edge's dynamic import failure message", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: /x.js"))).toBe(
      true
    );
  });

  it("matches Firefox's dynamic import failure message", () => {
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module: /x.js"))
    ).toBe(true);
  });

  it("matches Safari's module script failure message", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
  });

  it("does not match an unrelated error", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
  });

  it("does not match a non-Error value with no matching text", () => {
    expect(isChunkLoadError("plain string")).toBe(false);
  });
});

describe("shouldRetryChunkReload", () => {
  it("allows a retry when no attempt has been recorded yet", () => {
    expect(shouldRetryChunkReload(0, 10_001, 10_000)).toBe(true);
  });

  it("blocks a retry immediately after a recent attempt", () => {
    expect(shouldRetryChunkReload(9_000, 10_000, 10_000)).toBe(false);
  });

  it("allows a retry once the guard window has elapsed", () => {
    expect(shouldRetryChunkReload(0, 20_001, 20_000)).toBe(true);
  });
});
