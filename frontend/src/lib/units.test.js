import { describe, expect, it } from "vitest";

import { formatLengthCm, formatWeightDeltaKg, formatWeightKg } from "./units";

describe("metric unit formatting", () => {
  it("keeps stored weights and measurements in metric regardless of a legacy preference", () => {
    expect(formatWeightKg(72.5, "imperial")).toBe("72.5 kg");
    expect(formatLengthCm(182, "imperial")).toBe("182.0 cm");
    expect(formatWeightDeltaKg(-1.2, "imperial")).toBe("-1.2 kg");
  });
});
