# Invite account data ownership

Each session-authenticated account owns its workout plans and history, active
workout sessions, programs and schedule, biometrics, nutrition plans and meal
entries, sleep entries, step counts, settings, and API tokens. REST reads,
aggregates, exports, updates, and deletes are scoped on the server to the
authenticated owner. Nested rows inherit access through their parent record.

Exercise catalogue entries with no owner are shared read-only templates. An
account may read those templates and its own exercise entries. Food records
and all other personal data are private to their owner. A user-created record
is assigned to the authenticated account on insert; clients cannot choose or
change its owner.

## Existing data

The additive SQLite migration assigns existing personal records to the
earliest account administrator when one already exists. If no account exists
yet, records remain unassigned and only the bootstrap API key can access them.
The first-admin bootstrap script claims those unassigned personal records
before inviting anyone. This keeps legacy workout history intact and gives it
one clear owner before multi-account access begins.

## Administrative access

The configured `API_KEY` remains a global administrative credential for
backwards-compatible scripts and account setup. Keep it server-side and never
give it to invited users. Session-authenticated admins manage accounts but
still see only their own health and workout records. Account-created API tokens
inherit the creating account's data scope.

MCP tool calls are scoped the same way. A call made with an account's API
token (`MCP_API_KEY_AUTH_ENABLED=true`) sees and writes only that token
owner's records, plus the shared exercise templates. A call made over OAuth
acts for the account named by `MCP_OAUTH_ACCOUNT_EMAIL`; if that email matches
no account the tool call fails. With `MCP_OAUTH_ACCOUNT_EMAIL` unset, OAuth
calls stay unscoped as before, so set it before enabling MCP OAuth on a
deployment with more than one account. The bootstrap `API_KEY` is refused on
`/mcp/`.
