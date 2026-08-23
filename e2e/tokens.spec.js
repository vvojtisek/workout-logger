import { expect, test } from "@playwright/test";

test("mints a scoped token, verifies scope enforcement, and revokes it through the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `tokens-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:tokens]`;
  const bootstrapKey = process.env.E2E_API_KEY || "";

  let tokenId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, bootstrapKey);

    await page.goto("/");
    await page.getByRole("button", { name: "Tokens" }).click();
    await expect(page.getByRole("heading", { name: "API Tokens" })).toBeVisible();

    // Mint a read-only token entirely through the GUI.
    await page.getByRole("button", { name: "New token" }).click();
    await expect(page.getByRole("heading", { name: "New API Token" })).toBeVisible();
    await page.getByLabel("Name").fill(`${tag} read-only`);
    // "read" and "log" are checked by default; uncheck "log" to leave only "read".
    await page.getByRole("checkbox", { name: /^log/ }).uncheck();
    await page.getByRole("button", { name: "Create token", exact: true }).click();
    await expect(page.getByRole("heading", { name: "API Tokens" })).toBeVisible();

    // The raw secret is revealed exactly once, right after creation.
    const reveal = page.locator("#new-token-reveal");
    await expect(reveal).toBeVisible();
    const mintedToken = await reveal.locator("code").innerText();
    expect(mintedToken).toMatch(/^wl_/);
    await reveal.getByRole("button", { name: "I've saved it" }).click();
    await expect(reveal).toBeHidden();

    const list = await request.get("/api/v1/tokens?limit=100", {
      headers: { "X-API-Key": bootstrapKey },
    });
    /** @type {{items: Array<{id: string, name: string, scopes: string[]}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((token) => token.name === `${tag} read-only`);
    expect(created).toBeTruthy();
    expect(created?.scopes).toEqual(["read"]);
    tokenId = created?.id;

    // The read-only token can read but not write.
    const readResponse = await request.get("/api/v1/plans", {
      headers: { "X-API-Key": mintedToken },
    });
    expect(readResponse.status()).toBe(200);

    const writeResponse = await request.post("/api/v1/plans", {
      headers: { "X-API-Key": mintedToken },
      data: { name: `${tag} should be blocked`, exercises: [] },
    });
    expect(writeResponse.status()).toBe(403);

    // Revoke through the GUI and prove the token stops authenticating.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} read-only` })
      .getByRole("button", { name: "Revoke" })
      .click();
    await page
      .getByRole("dialog", { name: "Revoke API token" })
      .getByRole("button", { name: "Revoke" })
      .click();
    await expect(
      page.getByRole("listitem").filter({ hasText: `${tag} read-only` }).getByText("revoked"),
    ).toBeVisible();

    const afterRevoke = await request.get("/api/v1/plans", {
      headers: { "X-API-Key": mintedToken },
    });
    expect(afterRevoke.status()).toBe(401);
    tokenId = undefined;
  } finally {
    if (tokenId) {
      await request.post(`/api/v1/tokens/${tokenId}/revoke`, {
        headers: { "X-API-Key": bootstrapKey },
      });
    }
  }
});
