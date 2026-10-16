import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

/** @param {Date} date */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

test("adds a weekly game, sees it on the calendar, edits and deletes it", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `schedule-${Date.now()}`;
  const name = `[E2E:${TEST_RUN_ID}:schedule] League game`;

  async function deleteCreated() {
    const list = await request.get("/api/v1/load-events?limit=100");
    expect(list.status()).toBe(200);
    for (const event of (await list.json()).items) {
      if (event.name !== name) continue;
      expect((await request.delete(`/api/v1/load-events/${event.id}`)).status()).toBe(204);
    }
  }

  // The calendar opens on the current UTC month; put the game on today's
  // weekday for a season starting on the 1st, so the month shows it.
  const today = new Date();
  const weekday = (today.getUTCDay() + 6) % 7;
  const weekdayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday];
  const seasonStart = isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const seasonEnd = isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, 1)));

  try {
    page.setDefaultTimeout(5_000);
    await page.goto("/");
    await openPage(page, "Sport schedule");
    await expect(page.getByRole("heading", { name: "Sport schedule", exact: true })).toBeVisible();

    const form = page.locator("#sport-schedule-view").getByText("Add a game or practice").locator("..");
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Kind").selectOption("game");
    await form.getByLabel("Day").selectOption(weekdayLabel);
    await form.getByLabel("Start time").fill("19:30");
    await form.getByLabel("Minutes").fill("75");
    await form.getByLabel("Season starts").fill(seasonStart);
    await form.getByLabel("Season ends").fill(seasonEnd);

    // An invalid duration is explained before anything is sent.
    await form.getByLabel("Minutes").fill("5");
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(form.getByText("Duration is a whole number from 15 to 300 minutes.")).toBeVisible();
    await form.getByLabel("Minutes").fill("75");
    await form.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByText(`Added "${name}"`)).toBeVisible();

    const card = page
      .getByRole("list", { name: "Sport schedule" })
      .getByRole("listitem")
      .filter({ hasText: name });
    await expect(card.getByText(`Game, ${weekdayLabel} 19:30, 75 min`)).toBeVisible();

    const list = await request.get("/api/v1/load-events");
    const [saved] = (await list.json()).items.filter(
      (/** @type {{name: string}} */ event) => event.name === name,
    );
    expect(saved).toMatchObject({
      kind: "game",
      weekday,
      start_time: "19:30:00",
      duration_minutes: 75,
      season_start: seasonStart,
      season_end: seasonEnd,
    });

    // The calendar shows the game on every matching day of the month.
    await openPage(page, "Calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    const chips = page.getByTestId("calendar-load-event");
    await expect(chips.first()).toHaveText("Game 19:30");
    const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    let expected = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day));
      if ((date.getUTCDay() + 6) % 7 === weekday) expected += 1;
    }
    await expect(chips).toHaveCount(expected);

    // Move it to a practice and save.
    await openPage(page, "Sport schedule");
    await card.getByLabel("Kind").selectOption("practice");
    await card.getByRole("button", { name: `Save ${name}` }).click();
    await expect(page.getByText(`Saved "${name}"`)).toBeVisible();
    await expect(card.getByText(`Practice, ${weekdayLabel} 19:30, 75 min`)).toBeVisible();

    await card.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(`Deleted "${name}"`)).toBeVisible();
    await expect(card).toHaveCount(0);
  } finally {
    await deleteCreated();
  }
});
