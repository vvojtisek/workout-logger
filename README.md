# Workout Logger & Planner v2.0

A single-user Workout Logger & Planner API with a React Progressive Web App frontend. Built with **FastAPI + SQLAlchemy (async) + SQLite**, packaged as a container image and deployed declaratively to **Kubernetes (k3s)** using **GitOps (ArgoCD)** and **Helm**.

---

## Architecture & Tech Stack

* **Backend & API:** FastAPI (Python 3.11+), Pydantic v2, SQLAlchemy (asyncio), SQLite (WAL mode)
* **Frontend:** React 19 + TypeScript PWA, bundled by Vite with Tailwind CSS v4 (compiled into `app/static/dist/`)
* **Container Runtime:** Docker / OCI image (`ghcr.io/vvojtisek/workout-logger`)
* **Infrastructure:** K3s Kubernetes on AWS EC2
* **GitOps Operator:** ArgoCD
* **Packaging:** Helm chart (`helm/workout-logger`)
* **Ingress & TLS:** Traefik + cert-manager (Let's Encrypt HTTP-01)
* **Secrets:** Kubernetes Secret (`workout-logger-secret`) injected at runtime

---

## Repository Layout

```text
app/            FastAPI application (API, MCP server, models, schemas, services, compiled PWA bundle)
alembic/        Database schema migrations
helm/           Helm chart for Kubernetes deployment
deploy/         ArgoCD application manifests
tests/          pytest suite (unit + integration, httpx ASGI transport)
e2e/            Playwright journey against a deployed Kubernetes stack
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

> `API_KEY` is never logged, never embedded in the container image, and supplied exclusively via Kubernetes Secret at runtime.

The MCP server (`/mcp/`, used by ChatGPT and other MCP clients) authenticates separately via
OAuth 2.1 rather than `X-API-Key`; see [MCP Server](#mcp-server) below and `.env.example` for its
`MCP_OAUTH_*` variables.

The Helm chart requires `existingSecret` to name that externally managed Secret and
`apiKeySecretKey` to identify its data key. The defaults are `workout-logger-secret` and
`API_KEY`; override both the created Secret name and `existingSecret` together. The chart
validates these names before rendering and never creates or prints secret values. Application
and migration Pods do not mount Kubernetes API credentials by default; set
`serviceAccount.automount=true` only for a separately reviewed feature that requires API access.

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

Pull requests and pushes to `main` run independent backend, frontend, Kubernetes-manifest,
security, and real-cluster E2E jobs. The manifest job validates default and production Helm
renders against Kubernetes 1.35.0. The E2E job deploys the exact locally built image and a
real SQLite PVC into an ephemeral k3d cluster, exercises API CRUD plus the browser UI, deletes
its run-tagged records in a `finally` block, verifies absence through both the API and direct
SQLite counts, uploads diagnostics even on failure, and deletes the cluster.

Security gates reject any Python advisory reported by `pip-audit`, npm vulnerabilities at
high or critical severity, repository secrets reported by gitleaks, and fixed high or critical
container vulnerabilities reported by Trivy. Unfixed image findings remain visible but do not
fail the gate. Every scanned image also produces a downloadable SPDX JSON SBOM. Only a trusted
`main` push that passes all five gates can publish an immutable image or prepare a promotion.

### 2. Local Kubernetes Cluster (k3d)

```bash
# Create local cluster mapping host port 8000 to Ingress
k3d cluster create workout-cluster -p "8000:80@loadbalancer"

# Create required secret
kubectl create namespace prod
kubectl create secret generic workout-logger-secret \
  --namespace prod \
  --from-literal=API_KEY="local-dev-secret-key-must-be-32-chars-or-more"

# Deploy via Helm
helm template workout-logger ./helm/workout-logger -f ./helm/workout-logger/values.yaml
helm upgrade --install workout-logger ./helm/workout-logger -n prod

```

---

## Deployment Version Visibility

`scripts/generate_build_info.py` is the single source of truth for `APP_VERSION` (derived from
`git describe --tags --always`), `GIT_COMMIT` (the full Git SHA), and `BUILD_TIME` (UTC ISO-8601,
generated at build time). CI runs it once per `main` push and threads the result through the
whole chain, with nothing downstream recomputing its own value:

```text
GitHub push to main → scripts/generate_build_info.py
    → Docker build args (baked into build_info.json + OCI labels in the image)
    → scripts/promote_image.py (writes image.sourceCommit and env.APP_VERSION/
      GIT_COMMIT/BUILD_TIME into helm/workout-logger/values-prod.yaml)
    → Helm renders those into container env vars and the
      app.kubernetes.io/version Pod label / source-commit Pod annotation
    → the running app reads them from its environment (app/config.py),
      falling back to the baked build_info.json if unset
    → /health, the X-App-Version/X-Git-Commit/X-Build-Time headers, and the
      "Online · vX.Y.Z · <short commit>" indicator in the web UI
```

Verify a running production instance end-to-end:

```bash
curl https://fitness.vvojtisek.eu/health
curl -I https://fitness.vvojtisek.eu/
kubectl get pods --show-labels -l app.kubernetes.io/name=workout-logger
```

`/health`'s `commit`, the `X-Git-Commit` header, and the Pod's `app.kubernetes.io/version` label /
`workout-logger.vvojtisek.eu/source-commit` annotation must all agree; the
`scripts/verify_deployment_image.py` check below confirms this automatically.

---

## Production Deployment (k3s + ArgoCD)

The application is deployed to production automatically via **ArgoCD** tracking the `main` branch.

### 1. Secret Bootstrap (One-time setup per cluster)

Secrets are not stored in Git. The production secret must exist in namespace `prod`:

```bash
kubectl create namespace prod --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic workout-logger-secret \
  --namespace prod \
  --from-literal=API_KEY="<YOUR_PRODUCTION_API_KEY>" \
  --from-literal=MCP_OAUTH_CLIENT_SECRET="<AUTH0_APPLICATION_CLIENT_SECRET>" \
  --from-literal=MCP_OAUTH_JWT_SIGNING_KEY="<GENERATED_WITH_secrets.token_urlsafe_32_>" \
  --from-literal=MCP_OAUTH_STORAGE_KEY="<GENERATED_WITH_secrets.token_urlsafe_32_>"

```

The three `MCP_OAUTH_*` keys are only required when MCP OAuth is enabled (`values-prod.yaml`'s
`env.MCP_OAUTH_ENABLED: "true"`); the chart wires them into the Deployment via
`mcpOAuth.clientSecretKey` / `mcpOAuth.jwtSigningKeySecretKey` / `mcpOAuth.storageKeySecretKey`
(each names the key within this same Secret — set them in `values-prod.yaml`, never the values
themselves). See [Manual OAuth Provider Setup](#manual-oauth-provider-setup) for the Auth0 side.

The cluster must also provide a ready cert-manager `ClusterIssuer` named
`letsencrypt-prod`. The production Ingress requests its certificate from that issuer and
stores it in the `workout-logger-tls` Secret:

```bash
kubectl get clusterissuer letsencrypt-prod
kubectl wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s
```

### 2. Apply ArgoCD Application

```bash
kubectl apply -f deploy/argocd/application.yaml

```

ArgoCD continuously reconciles the cluster with Git:

* Applies `helm/workout-logger` using `values-prod.yaml`.
* Deploys the exact `image.digest` recorded in Git; mutable tags are not used in production.
* Configures persistent volume storage (`/data`).
* Manages Traefik Ingress with automatic Let's Encrypt TLS cert generation via `cert-manager`.

After each successful `main` workflow, CI publishes exactly one image tagged with the full
Git commit SHA and opens a promotion pull request that records both the source commit and
immutable registry digest in `values-prod.yaml`. CI approves the bot-created pull request's
workflow run when GitHub holds it for contributor approval, waits for the required checks,
and then squash-merges the pull request through normal branch protection. Argo CD detects
the Git change and remains the only deployment reconciler.
Promotion-only commits retain a `[skip image publish]` marker as defense in depth against
recursive image publication.

Verify the promoted commit, requested image digest, and image ID actually running in the
cluster with:

```bash
python scripts/verify_deployment_image.py \
  --values helm/workout-logger/values-prod.yaml \
  --namespace prod \
  --selector app.kubernetes.io/name=workout-logger
```

The check fails if the Pod annotation, requested image, or runtime image ID differs from
the Git-tracked promotion.

### SQLite upgrade and shutdown behavior

Production deliberately runs one replica with the Kubernetes `Recreate` strategy while
SQLite is stored on a ReadWriteOnce volume. During an upgrade, Kubernetes fully terminates
the old Pod before starting the new one, so two application processes never access the
database concurrently. The application is unavailable during that interval; allow several
minutes for the five-second endpoint-drain delay, graceful shutdown, image pull, migration,
and startup.

The startup probe allows up to five minutes for initialization before liveness checks begin.
Liveness checks only the running process at `/health/live`; a database outage instead fails
`/health/ready` and removes the Pod from Service endpoints without causing liveness restart
thrashing. Kubernetes provides a 60-second termination budget: after a five-second pre-stop
drain, Uvicorn handles SIGTERM and has up to 50 seconds to finish in-flight requests before
the remaining safety margin expires.

---

## Database Migrations

Migrations are managed with **Alembic**. Standalone containers execute them on startup through
`scripts/entrypoint.sh`; Kubernetes releases use the controlled job described below.

In Kubernetes, migrations run as a bounded Argo CD `PreSync` Job using the exact promoted
application image and database PVC. Application Pods receive
`RUN_MIGRATIONS_ON_STARTUP=false`, so restarts do not independently migrate production.
The Job name is derived from the release image and migration command, so repeated syncs do
not rerun Alembic for the same release. A locked success marker on the database PVC makes
this guarantee survive Job deletion or recreation. Each attempt also writes its combined
output to `/data/migration-releases/<release-id>.log`, so logs survive later Argo pruning.
Inspect the immediate Job logs and the durable copy with:

```bash
kubectl get jobs -n prod -l app.kubernetes.io/name=workout-logger
kubectl logs -n prod job/<migration-job-name>
kubectl describe -n prod job/<migration-job-name>
kubectl exec -n prod deployment/workout-logger -- \
  cat /data/migration-releases/<release-id>.log
```

A failed PreSync hook blocks the Deployment update. Capture its logs before retrying, fix
the migration through Git, and promote a corrected image so Argo CD creates a fresh Job. Do not run a
manual `alembic downgrade` for a non-reversible migration. Instead, create a reviewed Git
maintenance change that scales the application to zero, verify no application Pod remains,
take a diagnostic backup, restore a previously verified pre-release backup with a dedicated
one-shot recovery Pod/Job, and revert the promoted image digest in Git. Argo CD must remain
the reconciler throughout recovery.

Do not delete a `.succeeded` release marker to force a rerun. Recovery must use a new reviewed
release identity so the original execution record remains auditable.

Standalone container use retains the historical behavior and runs migrations unless
`RUN_MIGRATIONS_ON_STARTUP=false` is explicitly set.

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

SQLite backups are created online by the chart's CronJob and written to the dedicated
backup PVC, never to the application data PVC. Every `.db` artifact has a `.json` sidecar
containing its UTC timestamp, source commit/release, immutable image reference, SHA-256,
size, and Alembic schema revision. Backup creation and restore both require checksum and
`PRAGMA integrity_check` validation.

Never copy a database over `/data/workout_logger.db` in a live Pod. Production restore is
a deliberate GitOps maintenance operation: the chart refuses to render the restore Job
unless the Deployment is scaled to zero and the migration hook is disabled. The later
recovery change makes an explicit migration decision before scaling back up. This design
accepts downtime for the entire maintenance window because SQLite cannot provide a safe
zero-downtime file replacement.

See [SQLite backup and restore runbook](docs/sqlite-backup-restore.md) for backup inspection,
isolated restore drills, production recovery, validation, abort, and cleanup steps.

---

## API Documentation

* **Interactive Docs:** `GET /docs` (Swagger UI).
* **Machine-Readable Spec:** `GET /openapi.json` (OpenAPI 3.1).
* **Compatibility Aliases:** `/workout-plans` maps to `/api/v1/plans`, `/workout-logs` maps to `/api/v1/logs`.

Active-workout Slice 1 adds authenticated `/api/v1/workout-sessions` operations to start or
resume a plan snapshot, idempotently save a set with an absolute rest deadline, read the session,
complete it into the existing workout-log history, and remove E2E records during verified cleanup.

### MCP Server

An MCP server is mounted at `/mcp` (streamable HTTP) inside this same FastAPI application — one
deployable, per the modular-monolith decision. Its tools call `app/services/*` directly rather
than looping back through HTTP, so they share the REST layer's validation and conflict handling.

Tools: `list_programs`, `get_plan`, `create_plan`, `schedule_workout`, `log_set`, `log_meal`,
`log_biometrics`, `get_daily_summary`.

The REST API keeps its own `X-API-Key` authentication, unchanged — see
[REST API-key authentication](#rest-api-key-authentication-unchanged) below. The MCP endpoint uses
OAuth 2.1 instead, described here.

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

FastMCP (`fastmcp>=2.14`, currently running `fastmcp` 3.x) supplies the OAuth 2.1 authorization
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
  granted to MCP clients.
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
`MCP_OAUTH_STORAGE_DIR`, `MCP_OAUTH_STORAGE_KEY`). `MCP_OAUTH_ENABLED` defaults to `false`; when
disabled, `/mcp/` has **no authentication at all**, so it must only be left disabled for local
development, never in a network-reachable deployment.

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
and [Deployment](#deployment) for the Helm/Kubernetes wiring.

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
| Client secret location | Auth0 Application → Settings → Client Secret → store as the `MCP_OAUTH_CLIENT_SECRET` key in the `workout-logger-secret` Kubernetes Secret (never in Git) |
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
