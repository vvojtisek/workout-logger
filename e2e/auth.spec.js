import { expect, test } from "@playwright/test";

// This spec exercises the logged-out flows themselves, so it starts from a
// blank browser context rather than the pre-authenticated e2e admin session
// every other spec uses.
test.use({ storageState: { cookies: [], origins: [] } });

const bootstrapKey = process.env.E2E_API_KEY || "";

test("invite acceptance, login, protected-route redirect, and logout through the real GUI", async ({
  page,
  request,
}) => {
  const email = `auth-spec-${Date.now()}@example.test`;
  const password = "correct horse battery staple";

  const created = await request.post("/api/v1/invites", {
    headers: { "X-API-Key": bootstrapKey },
    data: { email, role: "user" },
  });
  expect(created.ok()).toBeTruthy();
  const { token } = await created.json();

  // Visiting a protected route while logged out redirects to /login.
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/login$/);

  // Accept the invite through the real GUI.
  await page.goto(`/accept-invite?token=${token}`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Account created" })).toBeVisible();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Logging in redirects back to the page originally requested before the
  // logged-out redirect to /login.
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/plans$/);

  // The session persists across a full page reload.
  await page.reload();
  await expect(page).toHaveURL(/\/plans$/);

  // Logging out revokes the session server-side and redirects to /login.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong credentials show an error and do not navigate away from /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password", { exact: true }).fill("this is the wrong password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
