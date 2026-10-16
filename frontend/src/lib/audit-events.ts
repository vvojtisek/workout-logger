import type { AuditActorKind, AuditEvent } from "@/api/types";

export const ACTOR_KIND_LABELS: Record<AuditActorKind, string> = {
  user: "App user",
  mcp: "MCP client",
  api_token: "API token",
  api_key: "Bootstrap key",
  anonymous: "Not signed in",
};

/** Who caused an event, in one line. For an MCP client this is what the
 * client itself reported (its registered name and its initialize info);
 * the protocol carries no model name, so none is shown. */
export function describeActor(event: AuditEvent): string {
  if (event.actor_kind !== "mcp") {
    return `${event.actor} (${ACTOR_KIND_LABELS[event.actor_kind]})`;
  }
  const parts: string[] = [event.oauth_client_name || "MCP client"];
  if (event.mcp_client_name) {
    const version = event.mcp_client_version ? ` ${event.mcp_client_version}` : "";
    parts.push(`reports ${event.mcp_client_name}${version}`);
  }
  if (event.actor_subject) parts.push(`login ${event.actor_subject}`);
  return parts.join(" · ");
}

/** The action without the API prefix: "POST plans/{plan_id}" or "MCP log_set". */
export function describeAction(event: AuditEvent): string {
  if (event.action.startsWith("mcp:")) return `MCP ${event.action.slice(4)}`;
  return event.action.replace(" /api/v1/", " ");
}

/** The parameter summary as "key: value" pairs; values the server withheld
 * appear as their type (number, text, list[3]). */
export function describeParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}
