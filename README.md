# Workout Logger & Planner

A single-user Workout Logger & Planner API with a vanilla-JS Progressive Web App
frontend. FastAPI + SQLAlchemy (async) + SQLite, packaged as a single Docker
image with a locally built Tailwind CSS bundle (no CDN).

## Supported versions

| Component | Version |
|---|---|
| Python | 3.11 or newer (tested on 3.11–3.14) |
| Docker Engine | 24.0+ (or Podman 4.0+ as a drop-in replacement) |
| Docker Compose | v2 (the `docker compose` plugin, not the legacy `docker-compose` v1) |
| Node.js | 20+ (build-time only, for the Tailwind CSS build) |

The published Docker image runs on `python:3.11-slim` and needs no
Python/Node toolchain on the host — those are only required for local,
non-containerized development.

## Repository layout

```text
app/            FastAPI application (API, models, schemas, services, static PWA)
alembic/        Database migrations
tests/          pytest test suite (unit + integration, httpx ASGI transport)
scripts/        entrypoint.sh (container startup) and backup_database.py
frontend/       Tailwind CSS source (input.css) — compiled into app/static/styles.css
```

## Installation

### Option A — Docker Compose (recommended)

1. Copy the example environment file and set a real API key:

   ```bash
   cp .env.example .env
   # generate a random 32+ character key, e.g.:
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   # paste the result into API_KEY= in .env
   ```

2. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   The container entrypoint (`scripts/entrypoint.sh`) will, in order:
   1. validate configuration (refuses to start with a missing/short/default `API_KEY`),
   2. verify `/data` is writable,
   3. run `alembic upgrade head` to bring the database schema up to date,
   4. start `uvicorn` with a single worker (appropriate for SQLite's single-writer model).

3. Verify it's up:

   ```bash
   curl http://127.0.0.1:8000/health
   ```

4. Open `http://127.0.0.1:8000/` for the PWA, or `http://127.0.0.1:8000/docs`
   for the interactive API documentation. The database persists in the named
   Docker volume `workout_data` (see `compose.yaml`).

### Option B — Local development (no Docker)

Requires Python 3.11+ and Node.js 20+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

npm install
npm run build:css          # builds app/static/styles.css from frontend/input.css

cp .env.example .env       # set a real API_KEY (32+ chars)
export $(grep -v '^#' .env | xargs)

alembic upgrade head
uvicorn app.main:app --reload
```

Run the test suite:

```bash
pytest --cov=app --cov-report=term-missing
ruff check .
ruff format --check .
mypy app/
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | yes | Shared secret for `X-API-Key` auth on all `/api/v1/*` routes. Must be 32+ characters and not a default/demo value — the app refuses to start otherwise. |
| `DATABASE_URL` | no (default: `sqlite+aiosqlite:////data/workout_logger.db`) | Async SQLAlchemy database URL. |
| `APP_ENV` | no (default: `production`) | Free-form environment label. |
| `APP_VERSION` | no (default: `1.0.0`) | Shown in `/health` and OpenAPI. |
| `LOG_LEVEL` | no (default: `INFO`) | Python logging level for structured JSON logs. |
| `TRUSTED_HOSTS` | no (default: `localhost,127.0.0.1`) | Comma-separated allow-list, for use by a reverse proxy / host-header validation. |

`API_KEY` is never logged, never embedded in the Docker image, and never
appears in served HTML/JS — it is supplied at runtime only.

## Database migrations

Migrations are managed with Alembic and are the only supported way to change
the schema (`Base.metadata.create_all()` is not used in production).

```bash
# apply all pending migrations (also run automatically on container start)
alembic upgrade head

# generate a new migration after changing app/models/*.py
alembic revision --autogenerate -m "describe the change"

# inspect current DB revision
alembic current

# roll back one revision
alembic downgrade -1
```

When running Alembic locally, make sure `API_KEY` and `DATABASE_URL` are set
in the environment first (see `.env.example`) — `alembic/env.py` reads the
target database from the same settings as the application.

## Upgrading

1. Pull/build the new image:

   ```bash
   docker compose pull   # or: docker compose build
   ```

2. Recreate the container:

   ```bash
   docker compose up -d
   ```

   The entrypoint runs `alembic upgrade head` automatically before starting
   the server, so schema migrations are applied on every restart with no
   manual step required. The database itself lives in the `workout_data`
   volume and is untouched by image upgrades — removing and recreating the
   container does not lose data (only `docker compose down -v` would, since
   `-v` also removes volumes).

3. Check `/health` and `docker compose logs -f workout-logger` to confirm the
   new version came up cleanly.

## Backup and restore

The database runs in SQLite WAL mode, so a plain `cp` of the `.db` file while
the app is running can capture a torn/inconsistent snapshot (WAL mode keeps
uncommitted data across `.db`, `.db-wal` and `.db-shm` companion files).
Use the bundled `scripts/backup_database.py`, which performs a consistent
online backup via SQLite's native backup API and keeps a rolling window of
generations.

### Backup

```bash
# from the host, against a running container:
docker compose exec workout-logger \
  python scripts/backup_database.py --source /data/workout_logger.db --dest-dir /data/backups --keep 7

# copy the backup out of the container/volume to somewhere off the Docker host:
docker compose cp workout-logger:/data/backups ./backups
```

Run this on a schedule (e.g. cron/systemd timer on the host, calling
`docker compose exec ...`) and store the copied-out backups on separate
storage from the Docker volume — a backup that lives on the same disk as the
volume it's backing up does not protect against disk failure.

### Restore

1. Stop the application so nothing is writing to the database:

   ```bash
   docker compose stop workout-logger
   ```

2. Replace the live database file with the chosen backup generation:

   ```bash
   docker compose run --rm --no-deps -v workout_data:/data -v "$(pwd)/backups:/backups" \
     workout-logger sh -c "cp /backups/workout_logger-<timestamp>.db /data/workout_logger.db && \
                            rm -f /data/workout_logger.db-wal /data/workout_logger.db-shm"
   ```

3. Start the application again — the entrypoint will run `alembic upgrade head`
   against the restored file before serving traffic:

   ```bash
   docker compose up -d
   ```

4. Verify with `curl http://127.0.0.1:8000/health` and spot-check a few
   records via `/api/v1/plans` / `/api/v1/logs`.

### Periodic test restores

Treat backups you have never restored as unverified. Periodically restore a
backup into a throwaway volume/container and confirm the API returns the
expected data before trusting that backup strategy in production.

## Production deployment example

The app itself only binds to `127.0.0.1:8000` (see `compose.yaml`) and expects
TLS termination and routing from a reverse proxy in front of it. Below is a
minimal [Caddy](https://caddyserver.com/) example — Caddy handles automatic
HTTPS certificate issuance/renewal, which keeps this simple for a
single-instance deployment; Nginx or Traefik work equally well if you already
operate one of those.

`Caddyfile`:

```caddyfile
workout.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

`compose.yaml` addition to run Caddy alongside the app on the same host:

```yaml
services:
  workout-logger:
    build: .
    restart: unless-stopped
    environment:
      API_KEY: ${API_KEY}
      DATABASE_URL: sqlite+aiosqlite:////data/workout_logger.db
    volumes:
      - workout_data:/data
    ports:
      - "127.0.0.1:8000:8000"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - workout-logger

volumes:
  workout_data:
  caddy_data:
  caddy_config:
```

Notes for production:

- Set `API_KEY` via your orchestrator's secret store, not a committed `.env`
  file.
- The app enforces `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`
  headers on every response, and adds `Strict-Transport-Security` whenever a
  request arrives over HTTPS.
- Only ever run a single Uvicorn worker (already the default in the
  Dockerfile) — SQLite allows one writer at a time, so extra workers add
  process overhead without added throughput.
- Schedule `scripts/backup_database.py` (see [Backup and
  restore](#backup-and-restore)) independently of deployments.

## API documentation

- Interactive: `GET /docs` (Swagger UI, public — no API key required to view,
  but requests still need `X-API-Key` via the "Authorize" button to execute).
- Machine-readable: `GET /openapi.json`, with stable `operationId`s suitable
  for LLM/agent tool-calling clients.

## License

Not yet specified.
