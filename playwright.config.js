import { defineConfig } from "@playwright/test";

import { STORAGE_STATE_PATH } from "./e2e/global-setup.js";

// Specs that also run in a phone-sized viewport (Samsung S21 width). The list
// grows as each screen gets its mobile layout.
const MOBILE_SPECS = [
  "navigation.spec.js",
  "settings.spec.js",
  "build-version.spec.js",
  "auth.spec.js",
  "active-workout.spec.js",
  "workout-hud.spec.js",
  "master-detail.spec.js",
  "locations.spec.js",
  "train-at-location.spec.js",
  "sport-schedule.spec.js",
  "heavy-legs-warning.spec.js",
  "coaching-principles.spec.js",
  "food-catalog.spec.js",
  "today.spec.js",
  "volume-rules.spec.js",
];

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  retries: 0,
  globalSetup: "./e2e/global-setup.js",
  // On CI the "github" reporter also turns each failure into a check-run
  // annotation, so the reason is readable on the PR without the artifact.
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ...(process.env.CI ? [/** @type {["github"]} */ (["github"])] : []),
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8000",
    // Every spec's `page` and `request` fixtures start already logged in as
    // the e2e admin session global-setup.js creates, so both browser-driven
    // flows and out-of-band API verification calls authenticate the same
    // way without each spec managing its own login.
    storageState: STORAGE_STATE_PATH,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      testMatch: MOBILE_SPECS,
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
