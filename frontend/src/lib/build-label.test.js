import { describe, expect, it } from "vitest";

import { describeBuild } from "./build-label";

const SHA = "623797f0c1d2e3f4a5b6c7d8e9f0011223344556";

describe("describeBuild", () => {
  it("shows a release tag and the short commit", () => {
    expect(describeBuild({ version: "v2.1.0", commit: SHA })).toEqual({
      text: "v2.1.0 · 623797f",
      description: "Release v2.1.0, commit 623797f",
      kind: "release",
    });
  });

  it("does not double the v of a tag", () => {
    expect(describeBuild({ version: "2.1.0", commit: SHA }).text).toBe("v2.1.0 · 623797f");
  });

  it("marks a release without a known commit", () => {
    expect(describeBuild({ version: "v2.1.0", commit: "unknown" }).text).toBe("v2.1.0");
  });

  it("marks local and in-between builds as development builds", () => {
    expect(describeBuild({ version: "local", commit: "unknown" })).toEqual({
      text: "dev build (local)",
      description: "Development build local, commit unknown",
      kind: "dev",
    });
    expect(describeBuild({ version: "v2.0.2-5-g623797f", commit: SHA }).text).toBe(
      "dev build (v2.0.2-5-g623797f)",
    );
    expect(describeBuild({ version: "v2.1.0-dirty", commit: SHA }).kind).toBe("dev");
  });

  it("says plainly when the server reports no version", () => {
    const missing = {
      text: "version unknown",
      description: "The server did not report its version",
      kind: "unknown",
    };
    expect(describeBuild({ version: "dev", commit: "unknown" })).toEqual(missing);
    expect(describeBuild({ version: "", commit: "" })).toEqual(missing);
    expect(describeBuild({})).toEqual(missing);
    expect(describeBuild(null)).toEqual(missing);
  });
});
