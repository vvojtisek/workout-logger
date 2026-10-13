import { request } from "@playwright/test";

// Session-cookie storage state shared by every spec's `page` and `request`
// fixtures (configured via `use.storageState` in playwright.config.js) --
// this is what lets the browser-driven UI flows and the out-of-band API
// verification calls in existing specs authenticate the same way, without
// each spec managing its own login.
export const STORAGE_STATE_PATH = "e2e/.auth/state.json";

const TEST_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@example.test";
const TEST_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "correct horse battery staple e2e";

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:8000";

  const context = await request.newContext({ baseURL });
  try {
    let loginResponse = await context.post("/api/v1/auth/login", {
      data: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });

    if (!loginResponse.ok()) {
      throw new Error(
        `Failed to log in as the bootstrapped e2e admin: ${loginResponse.status()} ${await loginResponse.text()}`
      );
    }

    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await context.dispose();
  }
}
