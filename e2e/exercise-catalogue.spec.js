import { expect, test } from "@playwright/test";

test("builds, views, edits, and deletes a real exercise catalogue entry through the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `catalogue-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:catalogue]`;
  let exerciseId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Exercises" }).click();
    await expect(page.getByRole("heading", { name: "Exercise Catalogue" })).toBeVisible();

    // Build a fully-populated exercise entirely through the UI.
    await page.getByRole("button", { name: "New exercise" }).click();
    await expect(page.getByRole("heading", { name: "New Exercise" })).toBeVisible();

    await page.getByLabel("Name").fill(`${tag} Bench Press`);

    await page.getByRole("button", { name: "+ Add alias" }).click();
    await page.getByLabel("Aliases 1", { exact: true }).fill(`${tag} Flat Bench`);

    await page
      .getByLabel("Media URL (optional)")
      .fill("https://example.com/videos/bench-press.mp4");

    await page.getByRole("group", { name: "Primary muscles" }).getByRole("button", { name: "Chest" }).click();
    await page
      .getByRole("group", { name: "Secondary muscles" })
      .getByRole("button", { name: "Triceps" })
      .click();

    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByLabel("Instructions 1", { exact: true }).fill(`${tag} Lie on the bench.`);
    await page.getByLabel("Instructions 2", { exact: true }).fill(`${tag} Press the bar up.`);

    await page.getByLabel("Equipment (optional)").fill("Barbell");
    await page.getByLabel("Safety notes (optional)").fill("Use a spotter.");

    await page.getByRole("button", { name: "Create exercise" }).click();
    await expect(page.getByRole("heading", { name: `${tag} Bench Press` })).toBeVisible();

    // Capture the id immediately so a later assertion failure still lets the
    // finally block find and delete this record.
    const list = await request.get("/api/v1/exercises?limit=100");
    expect(list.status()).toBe(200);
    /** @type {{items: Array<{id: string, name: string}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((exercise) => exercise.name === `${tag} Bench Press`);
    expect(created).toBeTruthy();
    exerciseId = created?.id;

    // Read it back through the real API, no route interception.
    const read = await request.get(`/api/v1/exercises/${exerciseId}`);
    expect(read.status()).toBe(200);
    const readBody = await read.json();
    expect(readBody).toMatchObject({
      name: `${tag} Bench Press`,
      aliases: [`${tag} Flat Bench`],
      media_url: "https://example.com/videos/bench-press.mp4",
      primary_muscles: ["chest"],
      secondary_muscles: ["triceps"],
      instructions: [`${tag} Lie on the bench.`, `${tag} Press the bar up.`],
      equipment: "Barbell",
      safety_notes: "Use a spotter.",
    });

    // The detail view (guide) landed here after creation; verify it renders
    // the link-out media card (cross-origin URL, never inlined), the muscle
    // badges, and the ordered instructions.
    await expect(page.getByText(`Also known as: ${tag} Flat Bench`)).toBeVisible();
    await expect(page.getByRole("link", { name: /Watch demonstration/ })).toHaveAttribute(
      "href",
      "https://example.com/videos/bench-press.mp4",
    );
    await expect(page.getByText("Chest", { exact: true })).toBeVisible();
    await expect(page.getByText("Triceps", { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag} Lie on the bench.`)).toBeVisible();
    await expect(page.getByText(`${tag} Press the bar up.`)).toBeVisible();
    await expect(page.getByText("Barbell")).toBeVisible();
    await expect(page.getByText("Use a spotter.")).toBeVisible();

    // Creating a second exercise with the same name must surface the 409
    // inline, never as a native alert.
    await page.getByRole("button", { name: "Exercises" }).click();
    await page.getByRole("button", { name: "New exercise" }).click();
    await page.getByLabel("Name").fill(`${tag} Bench Press`);
    await page.getByRole("button", { name: "Create exercise" }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Exercise Catalogue" })).toBeVisible();

    // Edit the exercise through the GUI and confirm the change persists.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} Bench Press` })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByRole("heading", { name: "Edit Exercise" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue(`${tag} Bench Press`);
    await page.getByLabel("Equipment (optional)").fill("Barbell, bench");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: `${tag} Bench Press` })).toBeVisible();

    const updated = await request.get(`/api/v1/exercises/${exerciseId}`);
    expect(updated.status()).toBe(200);
    expect((await updated.json()).equipment).toBe("Barbell, bench");

    // Delete through the GUI and prove it is gone.
    await page.getByRole("button", { name: "Exercises" }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} Bench Press` })
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog", { name: "Delete exercise" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.locator("#exercises-list").getByText(`${tag} Bench Press`, { exact: true }),
    ).toBeHidden();
    const afterDelete = await request.get(`/api/v1/exercises/${exerciseId}`);
    expect(afterDelete.status()).toBe(404);
    exerciseId = undefined;
  } finally {
    if (exerciseId) {
      await request.delete(`/api/v1/exercises/${exerciseId}`);
      expect((await request.get(`/api/v1/exercises/${exerciseId}`)).status()).toBe(404);
    }
  }
});
