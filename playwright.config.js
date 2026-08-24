import { defineConfig } from "@playwright/test";

import { STORAGE_STATE_PATH } from "./e2e/global-setup.js";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  retries: 0,
  globalSetup: "./e2e/global-setup.js",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
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
});
