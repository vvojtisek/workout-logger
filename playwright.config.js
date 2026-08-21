import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:8000",
    extraHTTPHeaders: { "X-API-Key": process.env.E2E_API_KEY || "" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
