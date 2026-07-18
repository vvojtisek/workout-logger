# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-17

First release candidate.

### Added

- FastAPI backend with async SQLAlchemy 2.x / `aiosqlite`, WAL mode, and
  per-connection `PRAGMA foreign_keys=ON`.
- Data model split into four tables — `workout_plans`, `plan_exercises`,
  `workout_logs`, `exercise_logs` — with UUID primary keys, cascading
  deletes for planned/performed exercises, and `ON DELETE SET NULL` from
  workout logs to their source plan (historical logs are preserved after a
  plan is deleted, with the plan name snapshotted at log-creation time).
- Full CRUD for workout plans (`/api/v1/plans`) and workout logs
  (`/api/v1/logs`), including pagination, date-range and source-plan
  filtering on logs, and atomic create/replace of a resource together with
  its child collection (planned or performed exercises) in one transaction.
- `X-API-Key` header authentication (constant-time comparison) on all
  `/api/v1/*` routes; `/health`, `/docs`, `/openapi.json`, `/`, and the PWA
  static assets remain public. The app refuses to start with a missing,
  too-short, or default/demo `API_KEY`.
- Structured JSON request logging (`request_id`, `method`, `path`,
  `status_code`, `duration_ms`) with no API keys, request bodies, or
  response bodies ever logged.
- Standardized error responses (`detail`, `code`, `request_id`) for
  401/404/409/422/503 and unhandled 500s.
- Alembic migrations as the sole supported schema-management path.
- Vanilla-JS PWA frontend: API key settings screen, plan list/selection,
  new-workout form with dynamic exercise rows, workout history and detail
  views, online/offline indicator, installable manifest, and a service
  worker (network-first for the HTML shell, cache-first for static assets,
  network-only and never cached for `/api/v1/*`, `/health`, `/docs`,
  `/openapi.json`).
- Locally built Tailwind CSS (no CDN) via a Node build stage.
- Security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security`
  over HTTPS) on every response.
- Multi-stage Docker image (Tailwind build stage + `python:3.11-slim`
  runtime), running as a non-root user, single Uvicorn worker, with an
  entrypoint that validates configuration, checks `/data` is writable, runs
  migrations, then starts the server.
- `scripts/backup_database.py` for consistent online SQLite backups (via the
  SQLite backup API, safe under WAL mode) with generation retention/pruning.
- Test suite (pytest + httpx `ASGITransport`) covering authentication,
  validation rules, transactional create/replace, cascade behavior, and API
  error states, at 100% line coverage of `app/`.
