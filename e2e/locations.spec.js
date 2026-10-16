import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

test("sets up Office, Gym and Home, ticks equipment, adds and deletes a location", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `locations-${Date.now()}`;
  const extraName = `[E2E:${TEST_RUN_ID}:locations] Hotel`;

  const created = new Set(["Office", "Gym", "Home", extraName]);
  let startedEmpty = false;

  /** Deletes the locations this spec created, and nothing else. */
  async function deleteCreatedLocations() {
    const list = await request.get("/api/v1/locations?limit=100");
    expect(list.status()).toBe(200);
    for (const location of (await list.json()).items) {
      if (!created.has(location.name)) continue;
      expect((await request.delete(`/api/v1/locations/${location.id}`)).status()).toBe(204);
    }
  }

  try {
    page.setDefaultTimeout(5_000);
    // The e2e account starts without locations; the page offers the usual three.
    const before = await request.get("/api/v1/locations");
    expect((await before.json()).items).toEqual([]);
    startedEmpty = true;
    await page.goto("/");
    await openPage(page, "Locations");
    await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Office, Gym and Home" }).click();

    const office = page.getByRole("listitem").filter({ has: page.getByRole("group", { name: "Office equipment" }) });
    await expect(office).toBeVisible();
    await expect(page.getByRole("group", { name: "Gym equipment" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Home equipment" })).toBeVisible();

    // Tick what the office has and save.
    await office.getByRole("button", { name: "Dumbbells", exact: true }).click();
    await office.getByRole("button", { name: "Bench", exact: true }).click();
    await office.getByLabel("Session minutes").fill("30");
    await office.getByRole("button", { name: "Save Office" }).click();
    await expect(page.getByText('Saved "Office"')).toBeVisible();
    await expect(office.getByRole("button", { name: "Save Office" })).toBeDisabled();

    const list = await request.get("/api/v1/locations");
    /** @type {{items: Array<{name: string, kind: string, equipment: string[], default_minutes: number | null}>}} */
    const body = await list.json();
    expect(body.items.map((location) => location.name)).toEqual(["Gym", "Home", "Office"]);
    expect(body.items.find((location) => location.name === "Office")).toMatchObject({
      kind: "office",
      equipment: ["bench", "dumbbell"],
      default_minutes: 30,
    });

    // A duplicate name is explained inline.
    await page.getByLabel("Name").last().fill("gym");
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByText(/already exists/)).toBeVisible();

    // Add one more and delete it through the GUI.
    await page.getByLabel("Name").last().fill(extraName);
    await page.getByLabel("Kind").last().selectOption("travel");
    await page.getByRole("group", { name: `${extraName} equipment` }).getByRole("button", { name: "Band", exact: true }).click();
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("button", { name: `Delete ${extraName}` })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${extraName}` }).click();
    await page.getByRole("dialog", { name: "Delete location" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: `Delete ${extraName}` })).toBeHidden();
    const afterDelete = await request.get("/api/v1/locations");
    expect((await afterDelete.json()).items.map((/** @type {{name: string}} */ l) => l.name)).toEqual([
      "Gym",
      "Home",
      "Office",
    ]);
  } finally {
    if (startedEmpty) await deleteCreatedLocations();
  }
});
