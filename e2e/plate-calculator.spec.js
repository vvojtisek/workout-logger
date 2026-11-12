import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("mobile workout plate calculator uses the configured equipment profile", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "The calculator is part of the mobile workout HUD");
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    await page.goto("/");
    await openPage(page, "Settings");
    await page.getByLabel("Barbell 20 kg: 20 kg plate pairs").fill("1");
    await page.getByRole("button", { name: "Add equipment profile" }).click();
    await page.getByLabel("Profile name").nth(1).fill("Technique bar 15 kg");
    await page.getByLabel("Bar weight (kg)").nth(1).fill("15");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect
      .poll(async () => (await (await request.get("/api/v1/settings")).json()).plate_inventory[1].pairs)
      .toBe(1);

    const created = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plate plan`,
        exercises: [
          {
            exercise_name: `${tag} squat`,
            target_sets: 1,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 82.5,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    planId = (await created.json()).id;

    await openPage(page, "Plans");
    const [started] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/v1/workout-sessions"),
      ),
      page
        .getByRole("listitem")
        .filter({ hasText: `${tag} plate plan` })
        .getByRole("button", { name: "Start workout" })
        .click(),
    ]);
    expect(started.status()).toBe(201);
    sessionId = (await started.json()).id;

    const calculator = page.getByRole("region", { name: "Plate calculator" });
    await expect(calculator).toBeVisible();
    await calculator.getByText("Plate calculator · 82.5 kg").click();
    await expect(calculator).toContainText("82.5 kg total");
    await expect(calculator).toContainText("25 kg + 5 kg + 1.25 kg per side");
    await calculator.getByLabel("Equipment profile").selectOption({ label: "Technique bar 15 kg" });
    await expect(calculator).toContainText("15 kg bar included; collars excluded.");
    await expect(calculator).toContainText("82.5 kg total");
    await page.getByLabel("Weight (kg)").fill("90");
    await expect(calculator).toContainText("90 kg total");
    await expect(calculator).toContainText("25 kg + 10 kg + 2.5 kg per side");
  } finally {
    if (sessionId) {
      expect((await request.delete(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(204);
    }
    if (planId) expect((await request.delete(`/api/v1/plans/${planId}`)).status()).toBe(204);
  }
});
