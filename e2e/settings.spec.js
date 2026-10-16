import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

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
    await openPage(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Units are fixed to metric; rest defaults remain user-editable.
    await expect(page.getByText("Metric (kg, cm)")).toBeVisible();
    await expect(page.getByText(/Imperial|lb|inches/i)).toHaveCount(0);
    await page.getByLabel("Default rest — compound (s)").fill("100");
    await page.getByLabel("Default rest — isolation (s)").fill("40");
    await page.getByRole("button", { name: "Save preferences" }).click();

    await expect
      .poll(async () => (await (await request.get("/api/v1/settings")).json()).units)
      .toBe("metric");
    const saved = await (await request.get("/api/v1/settings")).json();
    expect(saved.default_rest_compound_seconds).toBe(100);
    expect(saved.default_rest_isolation_seconds).toBe(40);

    // Reloading re-fetches from the server, proving it isn't just local state.
    await page.reload();
    await expect(page.getByText("Metric (kg, cm)")).toBeVisible();
    await expect(page.getByLabel("Default rest — compound (s)")).toHaveValue("100");
    await expect(page.getByLabel("Default rest — isolation (s)")).toHaveValue("40");

    // MCP status: the real server reports its real tool set.
    await expect(page.getByText(/10 tools? at \/mcp/)).toBeVisible();
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
    await openPage(page, "Plans");
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

test("switches the theme from Settings and keeps the choice across reloads", async ({ page }) => {
  page.setDefaultTimeout(5_000);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  // Dark is the default before anything is chosen, whatever the device prefers.
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).toBe("rgb(9, 13, 22)");

  await openPage(page, "Settings");
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

  await theme.getByRole("radio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(241, 245, 249)");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(theme.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");

  // System follows the device, including a change while the page is open.
  await theme.getByRole("radio", { name: "System" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");

  // Numbers use the bundled monospace font.
  const numericFont = await page
    .locator("#rest-compound")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(numericFont).toContain("JetBrains Mono");

  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
});
