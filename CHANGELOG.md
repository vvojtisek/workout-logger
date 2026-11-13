# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Workout UI/UX overhaul (see SPEC-UX.md). Phone: every control on the workout
  screen is at least 44 px, steppers 56 px; the rest timer is a persistent bar
  that stays visible after minimizing and on every page, and never takes the
  Log button's place; the top of the screen shows each set's logged result and
  the next exercise; logging a set updates the screen, starts rest and moves to
  the next set instantly, even offline, and syncs afterwards; Today leads with
  the workout and drops the boxes. Desktop: workout set rows are an even
  height, "Previous" shows what the set managed last session, and the rest
  timer is docked under the sets in mm:ss; Today becomes a dashboard with weekly
  volume, a muscle-group split and recent sessions; History rows show sets,
  volume and best set, with date and plan filters.
- The desktop rest timer reads `Rest: 01:30` instead of `Rest: 90s`.
- Plans: on desktop the plan list sits beside an inline-editing exercise table
  (sets, reps, weight, RIR, rest, laterality, superset group, notes) with a
  running exercise/set total and an "Unsaved changes" flag; saving keeps the plan
  open. On a phone each exercise is a flat block with 44 px controls and
  tabular numerals. Every `.btn` and `.input` is now at least 44 px tall.

### Added

- Plan exercises carry a target RIR (`target_rir`, 0-10, optional) and a
  `laterality` (`bilateral`, `per_side`, `single_limb`; default `bilateral`),
  through the REST API, MCP and the plan editor. They are stored and shown;
  the live workout does not yet split logging per side.

### Fixed

- MCP over Auth0: clients that log in now get the `read` and `log` scopes and
  see all tools. Before, the Auth0 proxy advertised no scopes, refused a client
  registering for `read log`, and handed out tokens that saw no tools. Auth0 is
  also asked for `offline_access`, so clients refresh instead of logging in
  again every day. The OAuth consent page keeps its styling.
- JetBrains Mono never loaded: the build inlined it as a `data:` URI that the
  Content-Security-Policy blocks, so weights, reps and timers used a fallback
  font and every page load logged a CSP error. Fonts are now emitted as files.
- Reloading or deep-linking to another page while a workout was active jumped
  back to the workout. The live workout is now reached from Today, or by
  tapping the rest bar, instead.

### Added

- `GET /api/v1/workout-sessions/active?optional=true` answers 204 instead of
  404 when no workout is active, so the app's start-up check leaves nothing
  in the browser console. Without the parameter the endpoint is unchanged.
- Health Connect import: `POST /api/v1/ingest/health-connect?timezone=...`
  takes the HC Webhook Android app's JSON and stores daily steps, sleep (with
  asleep and awake time from the stages) and exercise sessions (hockey, swims,
  rides, hikes, runs, strength). Re-sent records change nothing; a sleep or
  workout already logged by hand absorbs the watch's record instead of
  getting a duplicate, and keeps its rating and notes. Setup for a Galaxy
  Watch through Samsung Health is in docs/health-ingest.md.
- Phone Today screen, now the phone's home page. It shows today's date
  (dd/MM/yyyy) and week, last night's sleep, latest weight and the next game or
  practice, then one card each for the coach's session (start or resume it,
  with the heavy-legs warning), today's hockey (one tap on how it felt logs
  it), last night's sleep (usual times prefilled, one tap on how rested saves
  it) and food (energy and protein against the plan, and meals you ate before
  as one-tap chips that log them again now).
- Phone navigation is Today, History, a central Log button, Coach and More.
  Log opens a sheet with Food, Sleep, Activity, Weight, Start a workout and
  Past workout. Minimizing a live workout returns to Today on the phone.
- Action log: every write through the app or the REST API and every MCP tool
  call is recorded with who caused it (the signed-in user, the API token, or
  the MCP client's registered name, self-reported name and version, and OAuth
  login), the target record, success or failure, and a parameter summary
  without health values, passwords or tokens. Entries older than 72 hours are
  deleted. Admins see it under Settings, Action log
  (`GET /api/v1/audit-events`).
- Seed 37 basic foods (per 100 g, with vitamins and minerals) through a data
  migration that never duplicates or overwrites existing foods.
- Bundle a 1,030-entry fallback food catalogue that stays out of the database:
  the meal form can search it and add a missing food in one step
  (`GET /api/v1/food-catalog`, `POST /api/v1/food-catalog/{id}/add`).

### Changed

- Standardize displayed and entered dates as `YYYY-MM-DD` and local date-times
  as `YYYY-MM-DD HH:mm`, independent of browser locale.
- Use metric units throughout; normalize saved unit preferences without changing
  metric workout or biometrics records.

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
