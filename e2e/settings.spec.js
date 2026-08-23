import { expect, test } from "@playwright/test";

test("saves preferences, shows MCP status, and exports data through the real GUI", async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(5_000);
  await page.addInitScript((key) => {
    localStorage.setItem("workout_logger_api_key", key);
  }, process.env.E2E_API_KEY || "");

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Preferences: change units and rest defaults, save, and confirm the
    // real API now returns what was saved.
    await page.getByLabel("Imperial (lb, in)").check();
    await page.getByLabel("Default rest — compound (s)").fill("100");
    await page.getByLabel("Default rest — isolation (s)").fill("40");
    await page.getByRole("button", { name: "Save preferences" }).click();

    await expect
      .poll(async () => (await (await request.get("/api/v1/settings")).json()).units)
      .toBe("imperial");
    const saved = await (await request.get("/api/v1/settings")).json();
    expect(saved.default_rest_compound_seconds).toBe(100);
    expect(saved.default_rest_isolation_seconds).toBe(40);

    // Reloading re-fetches from the server, proving it isn't just local state.
    await page.reload();
    await expect(page.getByLabel("Imperial (lb, in)")).toBeChecked();
    await expect(page.getByLabel("Default rest — compound (s)")).toHaveValue("100");
    await expect(page.getByLabel("Default rest — isolation (s)")).toHaveValue("40");

    // MCP status: the real server reports its real tool set.
    await expect(page.getByText(/8 tools? at \/mcp/)).toBeVisible();
    await expect(page.getByText("enabled", { exact: true })).toBeVisible();

    // Export: both formats trigger a real browser download from the real API.
    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export as JSON" }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(/^workout-logger-export-.*\.json$/);

    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export as CSV" }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/^workout-logger-export-.*\.zip$/);

    // The plan builder now pre-fills rest seconds from the saved defaults.
    await page.getByRole("button", { name: "Plans" }).click();
    await page.getByRole("button", { name: "New program" }).click();
    await page.getByRole("button", { name: "+ Add compound exercise" }).click();
    await expect(page.locator("#plan-exercises-list > div").getByLabel("Rest seconds")).toHaveValue(
      "100"
    );
    await page.getByRole("button", { name: "+ Add isolation exercise" }).click();
    await expect(
      page.locator("#plan-exercises-list > div").nth(1).getByLabel("Rest seconds")
    ).toHaveValue("40");
  } finally {
    // Reset preferences so this spec is independently re-runnable.
    await request.put("/api/v1/settings", {
      data: { units: "metric", default_rest_compound_seconds: 90, default_rest_isolation_seconds: 60 },
    });
  }
});
