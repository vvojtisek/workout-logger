import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

test("the admin writes coaching principles in Settings and they persist", async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(5_000);
  const before = await (await request.get("/api/v1/coaching-principles")).json();
  const text = `E2E ${Date.now()}\n- Evidence-based methods only.\n- No heavy legs before hockey.`;

  try {
    await page.goto("/");
    await openPage(page, "Settings");
    const field = page.getByLabel("Principles");
    await expect(field).toHaveValue(before.body);
    const save = page.getByRole("button", { name: "Save principles" });
    await expect(save).toBeDisabled();

    await field.fill(text);
    await clickAndAwaitWrite(page, save, "PUT");
    await expect(save).toBeDisabled();

    const saved = await (await request.get("/api/v1/coaching-principles")).json();
    expect(saved.body).toBe(text);
    await expect(page.getByText(/last saved \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Principles")).toHaveValue(text);
  } finally {
    const restored = await request.put("/api/v1/coaching-principles", {
      data: { body: before.body },
    });
    expect(restored.ok()).toBe(true);
  }
});
