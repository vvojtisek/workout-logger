# Workout Logger & Planner v2.0

A single-user Workout Logger & Planner API with a vanilla-JS Progressive Web App frontend. Built with **FastAPI + SQLAlchemy (async) + SQLite**, packaged as a container image and deployed declaratively to **Kubernetes (k3s)** using **GitOps (ArgoCD)** and **Helm**.

---

## Architecture & Tech Stack

* **Backend & API:** FastAPI (Python 3.11+), Pydantic v2, SQLAlchemy (asyncio), SQLite (WAL mode)
* **Frontend:** Vanilla JS PWA + Tailwind CSS (compiled locally into `app/static/styles.css`)
* **Container Runtime:** Docker / OCI image (`ghcr.io/vvojtisek/workout-logger`)
* **Infrastructure:** K3s Kubernetes on AWS EC2
* **GitOps Operator:** ArgoCD
* **Packaging:** Helm chart (`helm/workout-logger`)
* **Ingress & TLS:** Traefik + cert-manager (Let's Encrypt HTTP-01)
* **Secrets:** Kubernetes Secret (`workout-logger-secret`) injected at runtime

---

## Repository Layout

```text
app/            FastAPI application (API, models, schemas, services, static PWA)
alembic/        Database schema migrations
helm/           Helm chart for Kubernetes deployment
deploy/         ArgoCD application manifests
tests/          pytest suite (unit + integration, httpx ASGI transport)
scripts/        entrypoint.sh (startup script) and backup_database.py
frontend/       Tailwind CSS source (input.css)

```

---

## Configuration

All configuration is managed via environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_KEY` | **yes** | — | Shared secret for `X-API-Key` auth on `/api/v1/*`. Must be 32+ characters. |
| `DATABASE_URL` | no | `sqlite+aiosqlite:////data/workout_logger.db` | Async SQLAlchemy database URL. |
| `APP_ENV` | no | `production` | Environment label (`development` / `production`). |
| `APP_VERSION` | no | `2.0.0` | Reported in `/health` and OpenAPI spec. |
| `LOG_LEVEL` | no | `INFO` | Python structured log level. |
| `TRUSTED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated host allow-list. |
| `PUBLIC_BASE_URL` | no | `https://fitness.vvojtisek.eu/` | Public HTTPS origin used in OpenAPI servers. |

> `API_KEY` is never logged, never embedded in the container image, and supplied exclusively via Kubernetes Secret at runtime.

---

## Local Development

### 1. Python Virtual Environment (No Docker)

Requires Python 3.11+ and Node.js 20+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

npm install
npm run build:css

cp .env.example .env       # set a real API_KEY (32+ chars)
export $(grep -v '^#' .env | xargs)

alembic upgrade head
uvicorn app.main:app --reload --port 8000

```

Run tests and linters:

```bash
pytest --cov=app --cov-report=term-missing
ruff check .
ruff format --check .
mypy app/

```

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

## Production Deployment (k3s + ArgoCD)

The application is deployed to production automatically via **ArgoCD** tracking the `main` branch.

### 1. Secret Bootstrap (One-time setup per cluster)

Secrets are not stored in Git. The production secret must exist in namespace `prod`:

```bash
kubectl create namespace prod --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic workout-logger-secret \
  --namespace prod \
  --from-literal=API_KEY="<YOUR_PRODUCTION_API_KEY>"

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

Staging is a separate Argo CD Application and namespace. Its immutable release and
last-known-good state are tracked in Git, and pull requests run a real ephemeral Argo CD
failure-and-recovery drill. See [GitOps staging and rollback runbook](docs/gitops-rollback.md).

After each successful `main` workflow, CI publishes exactly one image tagged with the full
Git commit SHA and opens a draft promotion pull request. Merging that pull request records
both the source commit and immutable registry digest in `values-prod.yaml`; Argo CD remains
the only deployment reconciler. Promotion-only commits retain a `[skip image publish]`
marker so merging a promotion cannot recursively publish another image and open another PR.

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
