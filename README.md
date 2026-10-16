# Workout Logger & Planner v2.0

A single-user Workout Logger & Planner API with a React Progressive Web App frontend. Built with **FastAPI + SQLAlchemy (async) + SQLite**, packaged as a container image and deployed with **Docker Compose** on a shared AWS EC2 host.

---

## Architecture & Tech Stack

* **Backend & API:** FastAPI (Python 3.11+), Pydantic v2, SQLAlchemy (asyncio), SQLite (WAL mode)
* **Frontend:** React 19 + TypeScript PWA, bundled by Vite with Tailwind CSS v4 (compiled into `app/static/dist/`)
* **Container Runtime:** Docker / OCI image (`ghcr.io/vvojtisek/workout-logger`)
* **Infrastructure:** Docker Compose on AWS EC2 (`deploy/aws/compose.yaml`), deployed through AWS Systems Manager
* **Reverse proxy & TLS:** the host's shared Caddy (Let's Encrypt via Route 53 DNS-01)
* **Secrets:** `/srv/workout-logger/.env.production` on the host (mode `0600`), never in Git or CI

---

## Repository Layout

```text
app/            FastAPI application (API, MCP server, models, schemas, services, compiled PWA bundle)
alembic/        Database schema migrations
deploy/aws/     Production Compose file, environment example, Caddy snippet, backup timer
tests/          pytest suite (unit + integration, httpx ASGI transport)
e2e/            Playwright journeys run against the production Compose file
scripts/        entrypoint.sh (startup script) and backup_database.py
frontend/       React + TypeScript single-page application source and Vitest unit tests

```

---

## Configuration

All configuration is managed via environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_KEY` | **yes** | — | Shared secret for `X-API-Key` auth on `/api/v1/*`. Must be 32+ characters. |
| `DATABASE_URL` | no | `sqlite+aiosqlite:////data/workout_logger.db` | Async SQLAlchemy database URL. |
| `APP_ENV` | no | `production` | Environment label (`development` / `production`). |
| `APP_VERSION` | no | baked into the image | Deployment version. Reported in `/health`, the `X-App-Version` header, OpenAPI spec, and the web UI. See [Deployment Version Visibility](#deployment-version-visibility). |
| `GIT_COMMIT` | no | baked into the image | Full Git SHA the running image was built from. Reported in `/health`, the `X-Git-Commit` header, and the web UI. |
| `BUILD_TIME` | no | baked into the image | UTC ISO-8601 build timestamp. Reported in `/health` and the `X-Build-Time` header. |
| `LOG_LEVEL` | no | `INFO` | Python structured log level. |
| `TRUSTED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated host allow-list. |
| `PUBLIC_BASE_URL` | no | `https://fitness.vvojtisek.eu/` | Public HTTPS origin used in OpenAPI servers. |

> `API_KEY` is never logged, never embedded in the container image, and supplied only through the host's production environment file at runtime.

The MCP server (`/mcp/`, used by ChatGPT and other MCP clients) authenticates separately via
OAuth 2.1 rather than `X-API-Key`; see [MCP Server](#mcp-server) below and `.env.example` for its
`MCP_OAUTH_*` variables.

### Invite-only accounts

Bootstrap the sole administrator once on an empty database with
`python scripts/create_first_admin.py --email <admin-email>`. Additional accounts can only be
created from admin-issued invites, and invites can grant the standard `user` role only. The
application reserves capacity for at most 10 regular accounts; active invites reserve a slot,
while accepted invites continue to occupy that slot as user accounts. Revoking or expiring a
pending invite frees its reserved slot. Disabled accounts still count toward the limit.

---

## Local Development

### 1. Python Virtual Environment (No Docker)

Requires Python 3.11+ and Node.js 20+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

npm install
npm run build          # compiles the SPA into app/static/dist (required before the server can serve /)

cp .env.example .env       # set a real API_KEY (32+ chars)
export $(grep -v '^#' .env | xargs)

alembic upgrade head
uvicorn app.main:app --reload --port 8000

```

For frontend work, run `npm run dev` alongside `uvicorn` instead: Vite serves the SPA with hot
module replacement on port 5173 and proxies `/api` and `/health` through to FastAPI on port 8000.

Run tests and linters:

```bash
pytest --cov=app --cov-report=term-missing
ruff check --select E4,E7,E9,F .
ruff format --check .
mypy app/
npm ci
npm run lint
npm run typecheck
npm test
npm run build

```

For active-workout slices, run `ruff check .` informationally as a baseline ratchet. New Python
files must pass the full rules, and issue #28's known baseline must not get worse.

### Continuous-integration gates

Every pull request runs **Fast checks**: backend (format, Ruff, mypy, pytest), frontend (lint,
typecheck, Vitest, build), deployment configuration validation (renders `deploy/aws/compose.yaml`
with `docker compose config` and syntax-checks the deploy scripts), and a dependency review that
fails when the pull request adds a dependency with a known vulnerability. Branch protection on
`main` requires the backend and frontend jobs.

Every pull request, and every push to `main`, also runs the end-to-end job against the **same
Compose file production uses**, so a breaking change is caught before it is merged: it builds the
exact image (with a shared GitHub Actions layer cache), starts it with `deploy/aws/compose.yaml`
plus the CI-only `e2e/compose.e2e.yaml` overlay (which only publishes a loopback port), checks the
Alembic revision, bootstraps an admin, runs every Playwright journey, verifies through direct
SQLite counts that run-tagged records were deleted, uploads diagnostics even on failure, and
removes the stack. Only after that passes on `main` does CI publish an image tagged with the full
commit SHA, with an SBOM attestation attached.

A `vX.Y.Z` tag on `main` publishes the release only if a Merge checks run on `main` has passed for
the tagged code (documentation-only commits are traced back to the last tested commit), then
reruns the unit tests and dependency audits and builds the amd64 and arm64 images with SBOM and
provenance attestations.

Security gates reject any Python advisory reported by `pip-audit`, npm vulnerabilities at
high or critical severity, repository secrets reported by gitleaks, and fixed high or critical
container vulnerabilities reported by Trivy. Unfixed image findings remain visible but do not
fail the gate. Every scanned image also produces a downloadable SPDX JSON SBOM.

### 2. Run the production Compose file locally

```bash
docker build --tag ghcr.io/vvojtisek/workout-logger:local .
printf 'API_KEY=%s\n' "$(openssl rand -hex 32)" > deploy/aws/.env.production
mkdir -p deploy/aws/data deploy/aws/backups && sudo chown 10001:10001 deploy/aws/data deploy/aws/backups
docker network create chem-app_public-net
RELEASE_TAG=local docker compose --env-file deploy/aws/.env.production \
  -f deploy/aws/compose.yaml -f e2e/compose.e2e.yaml up --detach --wait
curl http://127.0.0.1:18000/health/ready
```

---

## Deployment Version Visibility

`scripts/generate_build_info.py` is the single source of truth for `APP_VERSION` (derived from
`git describe --tags --always`), `GIT_COMMIT` (the full Git SHA), and `BUILD_TIME` (UTC ISO-8601,
generated at build time). CI passes them as Docker build args; they are baked into the image's
`build_info.json` and OCI labels, and the production Compose file sets `APP_VERSION` to the
release tag. They surface in `/health`, the `X-App-Version`/`X-Git-Commit`/`X-Build-Time`
headers, and the "Online · vX.Y.Z · <short commit>" indicator in the web UI:

```bash
curl https://fitness.vvojtisek.eu/health
curl -I https://fitness.vvojtisek.eu/
```

---

## Production Deployment

Production runs `deploy/aws/compose.yaml` on the shared EC2 host behind chem-app's Caddy.
Releases are semantic-version Git tags: the tag workflow publishes the image and a GitHub
Release with checksummed deployment assets, then deploys through AWS Systems Manager, taking
a verified SQLite backup before the new image starts and rolling back the image if it fails its
readiness check. Host setup, the release procedure, and admin bootstrap are documented in
[`deploy/aws/README.md`](deploy/aws/README.md).

### SQLite upgrade and shutdown behavior

Exactly one container writes the SQLite database. `docker compose up --force-recreate` stops
the old container before starting the new one, so two processes never write concurrently; the
app is briefly unavailable during an upgrade. Docker allows 60 seconds (`stop_grace_period`)
after SIGTERM, longer than Uvicorn's 50-second graceful shutdown. The container healthcheck
uses `/health/ready`, which fails when the database is unavailable.

---

## Database Migrations

Migrations are managed with **Alembic** and run on container startup through
`scripts/entrypoint.sh` (`RUN_MIGRATIONS_ON_STARTUP=true`). The deploy script takes a verified
online backup before starting an image that may migrate. Migrations must stay
backward-compatible with the previous release, because an automatic image rollback keeps the
already-migrated schema. Do not run a manual `alembic downgrade` for a non-reversible migration;
restore a verified pre-release backup instead (see below).

```bash
# Apply migrations manually (when running locally)
alembic upgrade head

# Generate a new migration after editing app/models/*.py
alembic revision --autogenerate -m "describe change"

# Inspect current schema revision
alembic current

# Rollback one revision
alembic downgrade -1

```

---

## Backup and Restore

A systemd timer on the host runs a daily online SQLite backup into
`/srv/workout-logger/backups` and keeps the 14 newest; the deploy script also backs up before
every upgrade. Every `.db` artifact has a `.json` sidecar containing its UTC timestamp, source
release, image reference, SHA-256, size, and Alembic schema revision. Backup creation and
restore both require checksum and `PRAGMA integrity_check` validation. Backups currently stay
on the same instance; copy them off the host until off-site replication exists.

Never copy a database over `/data/workout_logger.db` while the app is running. See the
[SQLite backup and restore runbook](docs/sqlite-backup-restore.md) for the restore procedure.

---

## API Documentation

* **Interactive Docs:** `GET /docs` (Swagger UI).
* **Machine-Readable Spec:** `GET /openapi.json` (OpenAPI 3.1).
* **Compatibility Aliases:** `/workout-plans` maps to `/api/v1/plans`, `/workout-logs` maps to `/api/v1/logs`.

Active-workout Slice 1 adds authenticated `/api/v1/workout-sessions` operations to start or
resume a plan snapshot, idempotently save a set with an absolute rest deadline, read the session,
complete it into the existing workout-log history, and remove E2E records during verified cleanup.

Invite-only accounts have server-enforced per-account record ownership. See
[`docs/account-data-ownership.md`](docs/account-data-ownership.md) for the legacy-data backfill,
shared exercise templates, and administrative access rules.

### MCP Server

An MCP server is mounted at `/mcp` (streamable HTTP) inside this same FastAPI application — one
deployable, per the modular-monolith decision. Its tools call `app/services/*` directly rather
than looping back through HTTP, so they share the REST layer's validation and conflict handling.

Tools: `list_programs`, `get_plan`, `create_plan`, `schedule_workout`, `log_set`, `log_meal`,
`log_biometrics`, `get_daily_summary`.

The REST API keeps its own `X-API-Key` authentication, unchanged — see
[REST API-key authentication](#rest-api-key-authentication-unchanged) below. The MCP endpoint uses
OAuth 2.1 instead, described here.

#### Action log

Every REST write (the app's UI included) and every MCP tool call writes one row to
`audit_events`: time, who (`user`, `api_token`, `api_key` or `mcp`), action, target, outcome
and a parameter summary that keeps only ids, names and dates. Health values, passwords and tokens
are never stored. For an MCP client the row holds the OAuth subject, the OAuth client id and the
name the client registered with, and the name and version the client reports in MCP; none of
these is verified, and MCP carries no model name. Rows older than 72 hours are deleted on each
write and never listed. Admins read it in Settings or at `GET /api/v1/audit-events`.

#### Connecting ChatGPT (or another MCP client) over OAuth

`/mcp/` authenticates with `Authorization: Bearer <access_token>` via OAuth 2.1 Authorization Code
+ PKCE, not `X-API-Key`. In ChatGPT (Developer Mode → Connectors → Add MCP server), enter only the
endpoint URL:

```text
https://fitness.vvojtisek.eu/mcp/
```

ChatGPT discovers everything else itself: it fetches
`/.well-known/oauth-protected-resource` (RFC 9728) to find the authorization server, walks that
server's own `/.well-known/oauth-authorization-server` (RFC 8414) metadata, registers itself as a
client, and runs the Authorization Code + PKCE (`S256`) flow. You will be prompted to log in with
the configured IdP and (unless consent is disabled) approve the connection; the account's IdP
subject must be on the `MCP_OAUTH_ALLOWED_SUBJECTS` allowlist below or the token is rejected.
Grant `read log` scope — query tools need `read`, logging tools need `log`. The bootstrap `API_KEY`
is never entered into ChatGPT and REST admin scope is never exposed to it.

To revoke access, remove the offending `sub` from `MCP_OAUTH_ALLOWED_SUBJECTS` and redeploy (or
revoke the session in the IdP's own dashboard, e.g. Auth0 → User → Sessions).

#### OAuth architecture

```text
REST / Health ingest / scripts  --  X-API-Key  -->  app/security.py  --\
                                                                          >-- app/services/*
ChatGPT / MCP clients  --  OAuth 2.1 Code+PKCE, Bearer token  -->  /mcp/ --/
```

FastMCP (`fastmcp>=4.1,<5`) supplies the OAuth 2.1 authorization
server proxy, RFC 9728 protected-resource metadata, and the `401 WWW-Authenticate` challenge
natively — none of that protocol plumbing is hand-rolled here. `app/mcp/oauth.py` adds only what's
specific to this deployment:

* **Provider** (`MCP_OAUTH_PROVIDER`): `auth0` (default, production) uses FastMCP's `Auth0Provider`
  — an OAuth proxy that bridges MCP clients requiring Dynamic Client Registration (ChatGPT) to a
  single pre-registered confidential Auth0 application, so ChatGPT itself never needs a client
  secret. `jwt` is a plain resource-server `JWTVerifier` against a known issuer's JWKS, with no
  registration bridging — used by the automated test suite and available as a lighter-weight
  option for issuers that already support public-client PKCE directly.
* **Subject allowlist** (`MCP_OAUTH_ALLOWED_SUBJECTS`): this is a private, single-user/family
  application, so a valid Auth0 login is necessary but not sufficient — the resolved `sub` claim
  must also be on this comma-separated allowlist, checked in `SubjectAllowlistAuth`.
* **Scopes**: each tool declares its own required scope natively —
  `@mcp.tool(auth=require_scopes("read"))` / `require_scopes("log")` in `app/mcp/server.py` — rather
  than a hand-rolled per-call check. `admin` is a REST-only scope and is never requested from or
  granted to MCP clients. The Auth0 proxy advertises `read` and `log`, grants both to a client that
  asks for none, and always asks Auth0 for `offline_access` so clients get a refresh token.
  `tests/test_mcp_auth0_flow.py` runs the whole registration and login flow against a fake Auth0.
* **Persistent storage**: FastMCP's OAuth proxy state (client registrations, encrypted
  upstream/refresh tokens) is written to `MCP_OAUTH_STORAGE_DIR` (default `/data/mcp-oauth`), a
  subdirectory of the same persistent volume as the SQLite database, encrypted at rest with Fernet
  (key derived from `MCP_OAUTH_STORAGE_KEY`). This survives pod restarts and redeployments on the
  single-replica production deployment the same way the database file does — no Redis needed.
* **Discovery mounting**: `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` must be reachable at the domain root (MCP/OAuth clients
  always look there first), not nested under `/mcp`. `app/main.py` registers these routes on the
  outer FastAPI app in addition to FastMCP's own copy under the mount. `GET /mcp` (no trailing
  slash) redirects (308) to `/mcp/` rather than 404ing, so it never becomes a second, subtly
  different OAuth resource identifier — the canonical resource is always
  `https://fitness.vvojtisek.eu/mcp/`.

#### Required environment variables

See `.env.example` for the full annotated list (`MCP_OAUTH_ENABLED`, `MCP_OAUTH_PROVIDER`,
`MCP_OAUTH_ISSUER`, `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, `MCP_OAUTH_AUDIENCE`,
`MCP_OAUTH_BASE_URL`, `MCP_OAUTH_ALLOWED_SUBJECTS`, `MCP_OAUTH_JWT_SIGNING_KEY`,
`MCP_OAUTH_STORAGE_DIR`, `MCP_OAUTH_STORAGE_KEY`). `MCP_OAUTH_ENABLED` defaults to `false`; while
disabled, the MCP transport and OAuth discovery routes are not mounted. Enable MCP only after its
OAuth provider and allowed-subject list are configured.

#### Local development setup

Local development can run without any real IdP by using the `jwt` provider against a locally
generated RSA key pair (the same approach the automated test suite uses in
`tests/conftest.py`):

```bash
python -c "
from fastmcp.server.auth.providers.jwt import RSAKeyPair
kp = RSAKeyPair.generate()
print('MCP_OAUTH_JWT_PUBLIC_KEY=' + kp.public_key.replace(chr(10), '\\\\n'))
print(kp.create_token(subject='local-dev-user', issuer='https://idp.example.test/', audience='https://fitness.example.test/mcp/', scopes=['read', 'log']))
"
```

Set `MCP_OAUTH_ENABLED=true`, `MCP_OAUTH_PROVIDER=jwt`, `MCP_OAUTH_ISSUER`/`MCP_OAUTH_AUDIENCE` to
match what you passed above, `MCP_OAUTH_JWT_PUBLIC_KEY` to the printed public key, and
`MCP_OAUTH_ALLOWED_SUBJECTS=local-dev-user`; use the printed token as the bearer token.

#### Production setup

See [Manual OAuth Provider Setup](#manual-oauth-provider-setup) for the exact Auth0 configuration,
and [`deploy/aws/README.md`](deploy/aws/README.md) for where production environment variables live.

#### Testing OAuth

* **Automated**: `pytest tests/test_mcp_oauth.py tests/test_mcp_server.py tests/test_config.py`
  covers discovery metadata, the 401 challenge, token validation (expiry/issuer/audience/signature/
  allowlist), and per-tool scope enforcement, using FastMCP's `jwt` provider against a locally
  generated key pair (no network calls).
* **MCP Inspector** (`npx @modelcontextprotocol/inspector`): point it at `https://<host>/mcp/`; it
  walks the same discovery → PKCE → token exchange → tool-call flow a real client does, against the
  real configured Auth0 tenant.
* **ChatGPT Developer Mode**: see [Connecting ChatGPT](#connecting-chatgpt-or-another-mcp-client-over-oauth)
  above.

#### REST API-key authentication (unchanged)

Authentication uses the same `X-API-Key` credential as before — either the bootstrap `API_KEY` or
a scoped token minted at `/api/v1/tokens`. `GET`/`HEAD`/`OPTIONS` require the `read` scope and every
other method requires `log`; an `admin` token satisfies both. Mint an agent a `read`+`log` token
rather than handing it the bootstrap key. This is unrelated to the MCP OAuth flow above and
continues to apply to `/api/v1/*`, including `/api/v1/ingest/*` health ingest, Android Health
Connect integrations, Tasker, and HTTP Shortcuts:

```bash
curl -H "X-API-Key: wl_..." https://your-host/api/v1/plans
```

### Manual OAuth Provider Setup

This has to be done once, outside the repository, in the Auth0 dashboard:

| Setting | Value |
| --- | --- |
| Application type | Regular Web Application (confidential client — FastMCP's OAuth proxy holds the client secret; ChatGPT never sees it) |
| Allowed Callback URLs | `https://fitness.vvojtisek.eu/mcp/auth/callback` (FastMCP's default `OAuthProxy` redirect path, appended to `MCP_OAUTH_BASE_URL`/mcp; override with `redirect_path` in `app/mcp/oauth.py` if you need something else) |
| Allowed Logout URLs | not required |
| API audience/resource | Create an Auth0 API with identifier `https://fitness.vvojtisek.eu/mcp/` (this becomes `MCP_OAUTH_AUDIENCE`) |
| Scopes/permissions | Add `read` and `log` as Permissions on that API; do **not** add or expose `admin` |
| Required grant types | Authorization Code (with PKCE); enable "Allow Skipping User Consent" only if you want to bypass FastMCP's own consent screen |
| Issuer URL | `https://<your-tenant>.<region>.auth0.com` — this becomes `MCP_OAUTH_ISSUER` |
| Client ID location | Auth0 Application → Settings → Client ID → set as `MCP_OAUTH_CLIENT_ID` |
| Client secret location | Auth0 Application → Settings → Client Secret → store as `MCP_OAUTH_CLIENT_SECRET` in the host's `/srv/workout-logger/.env.production` (never in Git) |
| Auth0 Action/rule required | None for the MVP. Add a Post-Login Action only if you want to restrict which Auth0 users can even attempt login (defense in depth — the app's own `MCP_OAUTH_ALLOWED_SUBJECTS` allowlist is the actual access-control boundary and is required regardless) |

After creating the application, note the user's Auth0 subject identifier (`sub`, e.g.
`auth0|65f1a2b3c4d5e6f7g8h9i0j1` or `google-oauth2|1234567890`) — visible under Auth0 →
User Management → Users → (user) → `user_id`. Put that value in `MCP_OAUTH_ALLOWED_SUBJECTS`.

### Health Ingest

`POST /api/v1/ingest/{weight|steps|sleep|sessions}` accepts pushes from Android sync apps
(Health Sync, Tasker, HTTP Shortcuts) reading Health Connect — no companion app required. Every
request carries `source` and `external_id`, unique together, so a re-sync never creates a
duplicate. See [`docs/health-ingest.md`](docs/health-ingest.md) for the endpoint reference and
setup recipes for each app.
