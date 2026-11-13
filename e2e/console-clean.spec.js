import { expect, test } from "@playwright/test";

// A cold load must not log warnings or errors (e.g. React Router's missing
// HydrateFallback notice, or a CSP violation).
for (const theme of ["dark", "light"]) {
  test(`cold load of Today is console-clean in the ${theme} theme`, async ({ page }) => {
    const noisy = [];
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") noisy.push(m.text());
    });
    await page.addInitScript((t) => localStorage.setItem("workout_logger_theme", t), theme);
    await page.goto("/today");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("link", { name: /Today/ }).first()).toBeVisible();
    expect(noisy).toEqual([]);
  });
}
