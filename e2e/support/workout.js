// The live workout differs by viewport: a set table on desktop, a one-set HUD
// with steppers and RIR pills on a phone. These helpers do the same thing in
// whichever one the page shows.
import { expect } from "@playwright/test";

import { isDesktop } from "./navigation.js";

/** Matches the rest countdown in either layout ("Rest: 59s" or "RESTING — 00:59"). */
export const REST_RUNNING = /Rest: \d+s|RESTING — \d{2}:\d{2}/;

/** @param {import("@playwright/test").Page} page @param {string} value */
export async function setRir(page, value) {
  if (isDesktop(page)) {
    await page.getByLabel("RIR").fill(value);
  } else {
    await page
      .getByRole("radiogroup", { name: "RIR" })
      .getByRole("radio", { name: value })
      .click();
  }
}

/** @param {import("@playwright/test").Page} page @param {string} value */
export async function expectRir(page, value) {
  if (isDesktop(page)) {
    await expect(page.getByLabel("RIR")).toHaveValue(value);
  } else {
    await expect(
      page
        .getByRole("radiogroup", { name: "RIR" })
        .getByRole("radio", { name: value }),
    ).toHaveAttribute("aria-checked", "true");
  }
}

/** Saves the set on screen in a one-set workout. @param {import("@playwright/test").Page} page */
export async function saveOnlySet(page) {
  const name = isDesktop(page) ? "Save set" : "Complete set & start rest";
  await page.getByRole("button", { name }).click();
}
