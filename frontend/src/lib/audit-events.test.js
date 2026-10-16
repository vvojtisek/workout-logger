import { describe, expect, it } from "vitest";

import { describeAction, describeActor, describeParams } from "./audit-events";

/** @param {Record<string, unknown>} overrides @returns {any} */
function event(overrides) {
  return {
    actor_kind: "user",
    actor: "vlad@example.test",
    actor_subject: null,
    oauth_client_id: null,
    oauth_client_name: null,
    mcp_client_name: null,
    mcp_client_version: null,
    action: "POST /api/v1/plans",
    params: {},
    ...overrides,
  };
}

describe("describeActor", () => {
  it("names an app user and the kind of access", () => {
    expect(describeActor(event({}))).toBe("vlad@example.test (App user)");
  });

  it("shows what an MCP client reported about itself and who logged in", () => {
    expect(
      describeActor(
        event({
          actor_kind: "mcp",
          actor: "Claude",
          oauth_client_name: "Claude",
          mcp_client_name: "claude-ai",
          mcp_client_version: "0.1.0",
          actor_subject: "google-oauth2|123",
        }),
      ),
    ).toBe("Claude · reports claude-ai 0.1.0 · login google-oauth2|123");
  });

  it("falls back to a generic name when an MCP client registered none", () => {
    expect(describeActor(event({ actor_kind: "mcp", actor: "x" }))).toBe("MCP client");
  });
});

describe("describeAction", () => {
  it("drops the API prefix and marks MCP tools", () => {
    expect(describeAction(event({ action: "PUT /api/v1/plans/{plan_id}" }))).toBe(
      "PUT plans/{plan_id}",
    );
    expect(describeAction(event({ action: "mcp:log_set" }))).toBe("MCP log_set");
  });
});

describe("describeParams", () => {
  it("lists kept values and the type of withheld ones", () => {
    expect(describeParams({ name: "Push day", weight_kg: "number", scopes: ["read", "log"] })).toBe(
      "name: Push day · weight_kg: number · scopes: read, log",
    );
  });
});
