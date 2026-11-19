import { expect, test } from "@playwright/test";

test.use({ locale: "en-US", timezoneId: "Europe/Prague" });

test("the clock accepts digits and offers every hour and minute in a 12-hour device locale", async ({
  page,
}) => {
  await page.goto("/biometrics/new");
  const time = page.getByRole("textbox", { name: "Time", exact: true });
  await expect(time).toHaveAttribute("inputmode", "numeric");
  const choose = page.getByRole("button", { name: "Choose time", exact: true });
  await time.fill("1937");
  await time.press("Tab");
  await expect(time).toHaveValue("19:37");
  await choose.click();
  const picker = page.getByRole("dialog");
  const hours = picker.getByLabel("Hour", { exact: true });
  const minutes = picker.getByLabel("Minute", { exact: true });
  const padded = (/** @type {number} */ size) =>
    Array.from({ length: size }, (_, i) => String(i).padStart(2, "0"));
  await expect(hours.locator("option")).toHaveText(padded(24));
  await expect(minutes.locator("option")).toHaveText(padded(60));
  await expect(hours).toHaveValue("19");
  await expect(minutes).toHaveValue("37");
  await hours.selectOption("00");
  await minutes.selectOption("01");
  await picker.getByRole("button", { name: "Set time" }).click();
  await expect(time).toHaveValue("00:01");
  await choose.click();
  await hours.selectOption("12");
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(time).toHaveValue("00:01");
  await expect(choose).toBeFocused();
  await expect(page.locator('input[type="time"], input[type="datetime-local"]')).toHaveCount(0);
});

for (const [path, label] of [
  ["/log/new", "Performed at time"],
  ["/activity/new", "Started at time"],
  ["/activity/quick", "Start time"],
  ["/recovery", "Start time"],
  ["/nutrition/meals/new", "Eaten at time"],
  ["/sleep/new", "Wake time"],
]) {
  test(`24-hour entry is available at ${path}`, async ({ page }) => {
    await page.goto(path);
    const field = page.getByRole("textbox", { name: label, exact: true });
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await field.fill("2359");
    await field.press("Tab");
    await expect(field).toHaveValue("23:59");
    await expect(page.locator('input[type="time"], input[type="datetime-local"]')).toHaveCount(0);
  });
}
