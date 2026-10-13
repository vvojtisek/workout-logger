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

MCP OAuth remains disabled in the AWS deployment until its OAuth identity is
mapped to a specific account. The MCP tool server currently opens database
sessions outside the REST request authentication scope.
