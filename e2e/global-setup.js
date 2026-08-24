import { request } from "@playwright/test";

// Session-cookie storage state shared by every spec's `page` and `request`
// fixtures (configured via `use.storageState` in playwright.config.js) --
// this is what lets the browser-driven UI flows and the out-of-band API
// verification calls in existing specs authenticate the same way, without
// each spec managing its own login.
export const STORAGE_STATE_PATH = "e2e/.auth/state.json";

const TEST_ADMIN_EMAIL = "e2e-admin@example.test";
const TEST_ADMIN_PASSWORD = "correct horse battery staple e2e";

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:8000";
  const bootstrapKey = process.env.E2E_API_KEY || "";

  const context = await request.newContext({ baseURL });
  try {
    let loginResponse = await context.post("/api/v1/auth/login", {
      data: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });

    if (!loginResponse.ok()) {
      const inviteResponse = await context.post("/api/v1/invites", {
        headers: { "X-API-Key": bootstrapKey },
        data: { email: TEST_ADMIN_EMAIL, role: "admin" },
      });
      if (!inviteResponse.ok()) {
        throw new Error(
          `Failed to create e2e admin invite: ${inviteResponse.status()} ${await inviteResponse.text()}`
        );
      }
      const invite = await inviteResponse.json();

      const acceptResponse = await context.post("/api/v1/auth/invites/accept", {
        data: { token: invite.token, password: TEST_ADMIN_PASSWORD },
      });
      if (!acceptResponse.ok()) {
        throw new Error(
          `Failed to accept e2e admin invite: ${acceptResponse.status()} ${await acceptResponse.text()}`
        );
      }

      loginResponse = await context.post("/api/v1/auth/login", {
        data: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
      });
      if (!loginResponse.ok()) {
        throw new Error(
          `Failed to log in as the freshly created e2e admin: ${loginResponse.status()} ${await loginResponse.text()}`
        );
      }
    }

    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await context.dispose();
  }
}
