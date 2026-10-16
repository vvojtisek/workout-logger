import { expect } from "@playwright/test";

/**
 * Clicks a control that saves or deletes something, and returns once the
 * app's own write request has answered. On desktop a list stays on screen
 * beside its editor, so a visible list heading is not proof the save has
 * finished; reading the API before this resolves races the write.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} control
 * @param {"POST" | "PUT" | "PATCH" | "DELETE"} method
 */
export async function clickAndAwaitWrite(page, control, method) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === method && new URL(candidate.url()).pathname.startsWith("/api/v1/"),
  );
  await control.click();
  const answered = await response;
  expect(answered.ok(), `${method} ${answered.url()} answered ${answered.status()}`).toBe(true);
}
