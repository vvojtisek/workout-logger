AI Agent Implementation Instructions: Workout Logger to Family Health Tracker

1. Role and mission

Act as the software architect and lead full-stack developer for:

Repository: https://github.com/vvojtisek/workout-logger

Current product: single-user workout logger and planner

Target product: installable, responsive personal and family health-tracking PWA

Target users: approximately six invited family accounts

Target domains: strength training, cardio, sleep, nutrition, and a unified daily dashboard

Deployment: Kubernetes on k3s, packaged with Helm and reconciled through Argo CD

Your responsibility is to evolve the existing application incrementally without losing current workout history or destabilizing the production deployment.

Do not treat this as a greenfield rewrite. Preserve working behaviour, historical records, security controls, backup capability, and API compatibility until an explicitly tested migration replaces them.

The immediate product priority remains the active workout experience:

Start a planned workout in no more than two taps.

Record a correctly prefilled set in one tap.

Automatically start the correct rest timer.

Keep the current exercise, current set, next action, and timer visible.

Preserve progress across refresh, backgrounding, browser restart, and temporary network loss.

The broader architectural objective is a modular health platform that can add sleep, nutrition, cardio, dashboards, and lightweight family accounts without becoming a distributed microservice system.

2. Verified repository baseline

Before changing anything, verify the current branch and commit yourself. The following state was observed on main and must be treated as a starting hypothesis, not blindly assumed:

FastAPI, Pydantic v2, async SQLAlchemy, Alembic, and SQLite in WAL mode.

A vanilla-JavaScript PWA served by FastAPI with locally built Tailwind CSS.

Four principal fitness tables: workout plans, planned exercises, workout logs, and exercise logs.

Backend CRUD and validation tests already exist. Do not describe the project as having no testing foundation.

The frontend has only basic static/PWA tests and lacks component and browser user-journey coverage.

A GitHub Actions workflow runs Python checks, tests, frontend CSS build, Helm lint, image build, and conditional GHCR publishing.

A Helm chart, production values, PVC, Ingress, and Argo CD Application exist.

Argo CD tracks main with automated prune and self-heal.

The production values currently pin a mutable branch-style image tag rather than an immutable digest.

The pipeline does not perform a Kubernetes deployment, post-deployment validation, or automated rollback.

Migrations currently run in each application container entrypoint.

Liveness and readiness use the same /health endpoint.

The Kubernetes Deployment has one replica backed by a ReadWriteOnce PVC containing SQLite.

The Helm template hardcodes workout-logger-secret even though values expose an existingSecret setting.

serviceAccount.automount is enabled although the application does not need Kubernetes API credentials.

The README calls the application v2.0 even though the functional application remains fitness-only and several runtime/default versions still identify as v1.0.

Record any difference between this baseline and the current repository before planning implementation.

3. Critical architectural decisions

3.1 Use a modular monolith

Keep one deployable backend and one frontend. Organize the backend into explicit domains rather than creating microservices.

Target backend structure:

app/
  core/
    auth/
    config/
    database/
    observability/
  domains/
    fitness/
    sleep/
    nutrition/
    dashboard/
  api/
  main.py

Each domain owns its models, schemas, repository/query functions, services, routes, and tests. Cross-domain dashboard aggregation may query domain read models through a dedicated dashboard service. Do not introduce a message broker, event bus, or independent service deployment for six family users.

3.2 Recommended frontend stack

Replace the monolithic vanilla-JavaScript implementation incrementally with:

Vite

React with TypeScript in strict mode

React Router

TanStack Query for server state, caching, retries, and invalidation

Zod for client-side validation of API responses and forms where useful

Tailwind CSS with a small documented component/design-token layer

vite-plugin-pwa and Workbox for the application shell and controlled offline behaviour

IndexedDB for active workout drafts and queued writes

Recharts or lightweight SVG charts for the limited dashboard visualizations actually needed

Vitest, Testing Library, and Playwright

Use React rather than Preact for this expanded multi-domain application because the long-term component, accessibility, forms, charting, testing, and AI-assisted development ecosystem is materially stronger. Keep dependencies deliberate and measure the resulting bundle.

Performance budgets:

Initial compressed JavaScript target: less than 200 KiB before optional chart chunks.

Lazy-load domain routes and charting code.

No JavaScript or CSS CDN.

Avoid fetching entire histories for dashboard summaries.

Use server-side aggregation endpoints and pagination.

Track Lighthouse performance, accessibility, best-practice, and PWA results in CI without treating a single synthetic score as proof of real-world speed.

3.3 Recommended backend stack

Retain:

Python 3.11+

FastAPI

Pydantic v2

SQLAlchemy 2 async APIs

Alembic

Structured JSON logging

OpenAPI

Add only when required:

PostgreSQL before multi-user production release

asyncpg for PostgreSQL

Argon2 password hashing

signed, Secure, HttpOnly, SameSite cookies for browser sessions

OpenTelemetry or Prometheus-compatible metrics after essential application flows exist

Do not introduce Redis initially. At six users, database-backed sessions and normal database queries are sufficient.

3.4 Database strategy

SQLite remains acceptable for the current single-user, single-replica phase, but it conflicts with true progressive delivery and future multi-user scaling:

The ReadWriteOnce PVC and SQLite writer model require one application writer.

Blue/green or canary deployments may run old and new pods concurrently.

Container-startup migrations are unsafe once more than one pod can start.

Application rollback is only safe when database migrations remain backward compatible.

Therefore:

Keep SQLite during the initial CI/Kubernetes hardening and active-workout feature slice.

Use a Recreate deployment strategy or maxSurge: 0 and maxUnavailable: 1 while SQLite is production storage.

Use expand-contract, backward-compatible migrations.

Migrate to PostgreSQL before enabling family accounts, multiple replicas, or Argo Rollouts blue/green deployment.

Test the SQLite-to-PostgreSQL export/import using a production-like backup before changing production.

Do not claim zero-downtime or instant application rollback while production uses one SQLite PVC. The honest guarantee in that phase is automated detection and rapid reconciliation to the last known-good immutable image, with short downtime possible.

3.5 Authentication and data isolation roadmap

The shared X-API-Key is suitable only for the current single-user administrative phase. Do not extend it as the family authentication model.

Use the following transition:

v1.x: retain the API key for compatibility and administrative/API access.

v2.0: add invite-only users, password login, secure cookie sessions, logout, password change, and account disablement.

v2.0: add user_id ownership to every personal record and enforce it in every query and mutation.

v3.0: optionally add a household entity and explicit sharing of selected training or nutrition plans.

Never rely on filtering only in the frontend. Every backend list, get, update, and delete operation must scope data by the authenticated user. Cross-user access tests are mandatory.

4. Target domain schema

Use UUID primary keys, UTC timestamps, explicit ownership, appropriate indexes, additive migrations, and snapshot fields where historical meaning must survive catalogue changes.

4.1 Core identity

Target v2.0 tables:

users
  id
  email
  display_name
  password_hash
  role
  is_active
  timezone
  created_at
  updated_at

user_sessions
  id
  user_id
  token_hash
  expires_at
  revoked_at
  created_at

Optional v3.0 sharing:

households
household_memberships
shared_resources

Do not add household complexity until real sharing requirements exist.

4.2 Fitness catalogue and plans

exercises
  id
  owner_user_id nullable for global catalogue entries
  slug
  name
  description
  youtube_video_id
  instructions_json
  primary_muscles_json
  secondary_muscles_json
  equipment_tags_json
  movement_tags_json
  load_mode
  created_at
  updated_at

training_plans
  id
  owner_user_id
  name
  description
  is_active
  created_at
  updated_at

training_plan_blocks
  id
  training_plan_id
  block_type: single | superset | circuit
  sort_order
  label

training_plan_exercises
  id
  block_id
  exercise_id nullable
  exercise_name_snapshot
  sort_order
  target_sets
  target_reps_min
  target_reps_max
  target_weight_kg
  target_rir
  rest_time_seconds
  notes

4.3 Strength workout sessions

workout_sessions
  id
  user_id
  source_plan_id nullable
  source_plan_name_snapshot
  status: in_progress | completed | abandoned
  started_at
  completed_at nullable
  total_time_seconds nullable
  overall_feeling nullable
  notes
  revision
  rest_ends_at nullable
  created_at
  updated_at

workout_exercises
  id
  workout_session_id
  exercise_id nullable
  exercise_name_snapshot
  block_type_snapshot
  block_order
  exercise_order
  rest_time_seconds_snapshot
  notes

workout_sets
  id
  workout_exercise_id
  set_number
  weight_kg nullable
  repetitions nullable
  rir nullable
  status: planned | completed | skipped
  completed_at nullable
  notes
  revision

Preserve compatibility with the current workout log API during migration. Historical arrays must be migrated into individual set records and verified.

4.4 Cardio

cardio_activity_types
  id
  owner_user_id nullable
  name
  metric_profile

cardio_sessions
  id
  user_id
  activity_type_id
  started_at
  duration_seconds
  distance_meters nullable
  average_heart_rate nullable
  maximum_heart_rate nullable
  calories_kcal nullable
  perceived_effort nullable
  location nullable
  notes
  source
  created_at
  updated_at

Do not force swimming, running, cycling, and ice hockey into identical required fields. Use a common session record with validated optional metrics determined by activity type.

4.5 Sleep

sleep_entries
  id
  user_id
  sleep_start
  sleep_end
  timezone
  time_in_bed_seconds
  estimated_sleep_seconds nullable
  awake_seconds nullable
  quality_score nullable
  resting_heart_rate nullable
  notes
  source
  created_at
  updated_at

sleep_segments optional later
  sleep_entry_id
  stage
  started_at
  ended_at

Begin with manual summary entries. Do not design device-vendor integrations until the manual data model and dashboard are proven.

4.6 Nutrition

foods
  id
  owner_user_id nullable
  name
  brand nullable
  serving_quantity
  serving_unit
  energy_kcal
  protein_g
  carbohydrate_g
  fat_g
  fiber_g nullable
  source
  created_at
  updated_at

nutrition_plans
  id
  user_id
  name
  valid_from
  valid_to nullable
  energy_target_kcal
  protein_target_g
  carbohydrate_target_g
  fat_target_g
  fiber_target_g nullable

meal_entries
  id
  user_id
  consumed_at
  meal_type
  notes

meal_items
  id
  meal_entry_id
  food_id nullable
  food_name_snapshot
  quantity
  unit
  energy_kcal_snapshot
  protein_g_snapshot
  carbohydrate_g_snapshot
  fat_g_snapshot
  fiber_g_snapshot nullable

Snapshot nutrition values when food is logged so later catalogue edits do not rewrite history.

4.7 Dashboard read model

Do not store a generic daily-summary table initially. Build a dedicated dashboard query service that returns a bounded daily summary:

GET /api/v1/dashboard/daily?date=YYYY-MM-DD
GET /api/v1/dashboard/trends?from=...&to=...

Aggregate only the requested date range and use indexed queries. Introduce cached or materialized summaries only if measured performance requires them.

5. Testing policy: real application and disposable real data

Use strict red-green-refactor development for every stage.

For each stage:

Write the acceptance and integration tests first.

Run them and confirm they fail for the expected missing behaviour.

Implement the feature.

Run targeted tests.

Run the complete regression suite.

Deploy the built image into an ephemeral Kubernetes namespace or local k3d/kind cluster.

Execute the real browser/API acceptance scenario.

Delete generated records and verify deletion.

Commit locally only after the stage is green.

Stop before the next stage.

Every feature stage must include a path through:

Playwright or real HTTP client
  -> built frontend or real API
  -> actual authentication
  -> actual FastAPI route
  -> actual service and SQLAlchemy session
  -> migrated file-backed SQLite or PostgreSQL database
  -> read-back through the actual API

The following do not prove stage acceptance:

mocked fetch in browser acceptance tests;

mocked FastAPI routes or persistence services;

component props containing hard-coded records without a real API test;

screenshots alone;

bypassing authentication;

tests that never read persisted values back;

tests that leave generated records behind;

a Helm template render without installing it into a cluster.

Use unique data names:

TEST_RUN_ID=e2e_<UTC timestamp>_<random suffix>
record prefix=[E2E:<TEST_RUN_ID>]

Capture created IDs immediately. Cleanup must delete only those IDs in dependency order inside finally blocks. Verify absence afterward. If cleanup fails, create a credential-free cleanup manifest and report the stage as failed.

Remote production writes require all of:

E2E_BASE_URL
E2E_API_KEY or dedicated test-user credentials
E2E_ALLOW_REMOTE_WRITES=true

Without explicit remote access, report remote validation as blocked rather than passed. Local ephemeral Kubernetes E2E remains mandatory.

6. CI pipeline design

Replace the single mixed workflow job with explicit, dependency-aware gates.

6.1 Pull-request validation

Run on pull_request and relevant branch pushes with concurrency cancellation.

Required jobs:

backend-quality

install locked dependencies;

Ruff formatting and lint;

mypy;

pytest with coverage;

Alembic migration tests from a legacy database;

PostgreSQL tests once PostgreSQL support begins.

frontend-quality

npm ci;

lint;

TypeScript strict typecheck;

Vitest component/unit tests with coverage;

production build;

bundle-size budget;

static secret scan of built assets.

contract-and-security

generate and diff OpenAPI intentionally;

dependency audit;

secret scanning;

SAST;

SBOM generation;

container vulnerability scan after image build.

helm-validation

Helm lint;

Helm template for local, staging, and production values;

kubeconform or equivalent schema validation;

policy checks for non-root execution, read-only root filesystem where compatible, dropped capabilities, resource requests/limits, probes, immutable image references, and disabled service-account token automount.

integration-e2e

build the exact production image once;

start k3d or kind;

install dependencies and application chart into an ephemeral namespace;

apply real migrations;

wait for startup and readiness;

run API integration tests and Playwright user journeys;

verify test-data cleanup;

collect pod logs, events, screenshots, and traces only as failure artifacts.

Branch protection must require all relevant jobs before merge.

6.2 Image publication

On merge to main:

build from the already validated commit;

tag with the full Git commit SHA;

publish to GHCR;

record and deploy the immutable image digest;

attach SBOM and provenance/attestation where practical;

do not use latest, branch tags, or manually edited version tags as the production deployment identity.

Avoid publishing production-intended images from every feature-branch push.

6.3 Staging promotion

Create a staging Argo CD Application and values file. Production must not be the first Kubernetes environment that runs a new image.

Promotion flow:

merge to main
  -> publish immutable image
  -> update staging desired digest
  -> Argo CD staging sync
  -> rollout health checks
  -> migration verification
  -> API smoke tests
  -> Playwright critical journey
  -> mark digest eligible for production

Use a bot-authored promotion pull request or a dedicated environment manifest repository. Do not let CI mutate production directly without a reviewable desired-state change.

6.4 Production promotion

Use GitHub Environment protection for production. The production promotion changes only the immutable image digest and explicitly reviewed configuration.

Argo CD remains the only reconciler. Do not run helm upgrade from CI against the same resources Argo CD manages.

7. Kubernetes health, migrations, and rollback

7.1 Separate health endpoints

Implement:

GET /health/live
GET /health/ready
GET /health/startup

Liveness confirms the process/event loop is functioning and must not fail merely because the database has a brief outage.

Readiness confirms dependencies required to serve requests, including database access and schema compatibility.

Startup confirms initialization and migration prerequisites before liveness begins.

Add realistic initial delays, timeouts, failure thresholds, and a startup probe. Test probe behaviour.

7.2 Move migrations out of application startup

Do not keep alembic upgrade head in every web-container entrypoint once multiple replicas or progressive delivery are possible.

Use one controlled migration job:

Argo CD PreSync hook or explicitly sequenced Kubernetes Job;

one execution per release;

retry limits and visible logs;

readiness verifies the expected schema revision;

failed migration blocks rollout;

expand-contract migrations so the previous application version still runs during rollback.

Never automatically run destructive contract migrations in the same release that stops writing the old schema.

7.3 Current SQLite deployment safety

Until PostgreSQL migration:

keep one replica;

prevent two application pods from writing the same database concurrently;

use Recreate, or configure rolling update with zero surge;

take and verify a consistent backup before migration-bearing production releases;

ensure rollback images are compatible with the expanded schema;

scale the application down before destructive restore operations;

do not overwrite a live SQLite database file inside a running pod.

7.4 Automated rollback while using Argo CD

Do not implement rollback as an imperative helm rollback while Argo CD self-heal points at the failed desired state; Argo CD would reapply it.

For the SQLite phase:

Deploy an immutable digest through Git.

Observe Argo CD sync and Deployment availability.

Run post-sync health and synthetic user-journey checks.

If validation fails, automatically revert the promotion commit to the previously recorded stable digest.

Let Argo CD reconcile to that last known-good digest.

Block further promotion and preserve failure artifacts.

This is rapid GitOps rollback, not zero-downtime blue/green rollback.

7.5 Progressive delivery after PostgreSQL

After PostgreSQL migration and backward-compatible schema practices are proven, introduce Argo Rollouts:

blue/green is preferred for this small application;

preview service receives smoke and Playwright validation;

AnalysisTemplate checks readiness, error rate, latency, and critical API journey;

failed analysis aborts and keeps the stable ReplicaSet active;

successful analysis promotes preview to active;

retain a tested fast rollback window.

Do not enable multiple replicas before session handling, database use, migrations, and write conflict tests support it.

7.6 Helm corrections

Early platform work must:

use .Values.existingSecret rather than hardcoding a secret name;

disable service-account token automount unless required;

add deployment strategy configuration;

add startup, liveness, and readiness probes;

add termination grace handling;

pin immutable image digests in promoted environments;

add checksums only for configuration whose change should restart pods;

add NetworkPolicy where the cluster CNI enforces it;

keep one replica and avoid HPA while using SQLite;

add PodDisruptionBudget only when replica count and maintenance behaviour make it meaningful.

8. Phased roadmap

Implement exactly one stage at a time. Write tests first, confirm expected failure, implement, run every gate, perform real-data acceptance, cleanup, report, and stop.

Stage 0 — Baseline and architecture decision records

Deliver:

verified repository state and current production topology;

current CI result and deployment path;

data backup and restore drill result;

ADR for modular monolith;

ADR for React/Vite frontend;

ADR for SQLite-to-PostgreSQL timing;

ADR for GitOps promotion and rollback;

explicit versioning decision: current v1.x platform evolution versus actual v2.0 family release.

Test first:

real local application smoke test;

real file-backed database create/read/update/delete/cleanup test;

Helm install into local k3d/kind;

current production image readiness smoke test when authorized.

Stop after reporting the baseline. Do not begin implementation automatically.

Stage 1 — CI and Kubernetes safety foundation

Implement:

split GitHub Actions jobs;

PR trigger and required checks;

deterministic backend/frontend dependency installation;

Helm schema/policy validation;

ephemeral-cluster E2E harness;

immutable SHA/digest image publication;

separate health endpoints and probes;

secret-value wiring fix;

disabled service-account token automount;

explicit SQLite-safe deployment strategy;

safe restore documentation;

staging Argo CD Application;

rapid Git-revert rollback automation against a deliberately failing test release in staging.

Acceptance requires a controlled failed staging deployment that automatically returns to the last stable digest and proves the application and data remain available.

Stage 2 — Frontend platform and PWA shell

Implement:

Vite, React, TypeScript strict mode;

route-based code splitting;

TanStack Query API layer;

responsive design system and accessibility baseline;

installable PWA shell;

bottom navigation on normal routes;

active-workout route without global navigation;

loading, empty, offline, and error states;

Vitest and Playwright foundations;

measured bundle and Lighthouse budgets.

Preserve existing plan/history functionality during migration.

Stage 3 — Strength active-workout vertical slice

Implement the detailed workout requirements:

exercise catalogue and detail view;

plan blocks and supersets;

active session state;

per-set weight, reps, and RIR;

previous-set suggestions;

one-tap completion;

five-second Undo;

automatic rest timer with ±30 seconds and Skip;

absolute rest_ends_at time;

active state restoration;

IndexedDB queue and idempotent synchronization;

plan overview;

completion and history compatibility.

Mandatory Playwright journey:

Create catalogue exercises and a plan through the real API.

Create historical performance.

Start the plan through the UI.

Confirm previous values are suggestions.

Complete, undo, re-complete, and edit sets.

Verify API persistence after every action.

Verify timer across reload/background simulation.

Complete a set offline and synchronize exactly once after reconnect.

Complete the workout and verify history.

Delete all generated records and verify absence.

Stage 4 — Cardio and fitness dashboard

Implement:

configurable cardio activity types;

fast session logging for swimming, running, cycling, ice hockey, and other activity;

appropriate optional metrics;

recent sessions and trends;

unified fitness summary combining strength and cardio.

Do not invent calorie estimates unless a documented calculation or entered value exists.

Stage 5 — Sleep MVP

Implement:

manual sleep entry;

duration and quality calculations;

editable history;

seven-day and thirty-day trends;

timezone and overnight-boundary tests;

daily dashboard contribution.

Defer wearable/device integrations.

Stage 6 — Nutrition MVP

Implement:

reusable foods;

meal logging;

per-entry nutrition snapshots;

customizable dated nutrition targets;

daily energy and macronutrient totals;

progress against plan;

editing and deletion;

dashboard contribution.

Design the API so barcode/external food-data integration can be added later without making it part of the MVP.

Stage 7 — Unified dashboard and visualization

Implement:

one bounded daily summary endpoint;

workout status and active-session Resume CTA;

cardio summary;

sleep duration/quality;

nutrition totals against targets;

lightweight trends and comparisons;

accessible charts with textual equivalents;

mobile-first card ordering and user-controlled dashboard preferences only if justified.

Measure query count, response size, rendering time, and bundle impact.

Stage 8 — PostgreSQL and family accounts: v2.0

Implement:

PostgreSQL deployment and backup strategy;

tested SQLite export/import migration;

real PostgreSQL integration tests in CI;

invite-only user administration;

secure password and session authentication;

user_id ownership on every domain record;

migration of existing records to the initial owner;

strict cross-user isolation tests;

removal of API-key dependence from normal PWA use while retaining an explicit compatibility/admin path if required.

Release as v2.0 only after migration, restore, isolation, and rollback drills pass.

Stage 9 — Progressive delivery and resilience: v2.x

Implement:

Argo Rollouts blue/green;

preview and active services;

automated analysis;

multiple application replicas where justified;

external/session persistence suitable for replicas;

automatic abort and stable ReplicaSet retention;

PostgreSQL backup/restore drills;

observability alerts for error rate, latency, readiness, migration failure, storage, and backup age.

Stage 10 — Household sharing and integrations: v3.0

Only after real requirements are defined, consider:

household memberships;

sharing selected training or nutrition plans;

wearable imports;

external nutrition catalogue integrations;

export/import and account portability;

notification preferences.

Do not implement social feeds, commercial billing, organization administration, or complex tenancy infrastructure for six family accounts.

9. Stage gates and quality commands

At the end of every applicable stage, run and report exact results for:

pytest --cov=app --cov-report=term-missing
ruff check .
ruff format --check .
mypy app/
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
helm lint helm/workout-logger
helm template workout-logger helm/workout-logger -f helm/workout-logger/values.yaml
helm template workout-logger helm/workout-logger -f helm/workout-logger/values-prod.yaml

Also run the repository's final kubeconform, policy, security, SBOM, image-scan, ephemeral-cluster, and rollout-verification commands once they are added.

Do not move to the next stage if any required test is failing, skipped without approved reason, flaky, or unexecuted.

Do not reduce backend coverage silently. Add meaningful frontend coverage rather than chasing a number with implementation-detail tests.

10. Required report after every stage

Report:

Stage:
Status: PASSED | FAILED | BLOCKED

Tests written first:
- files and test names
- expected initial failure and why it proved the test was valid

Implementation:
- changed production files
- architecture decisions
- compatibility impact

Verification:
- exact command
- exit code
- passed/failed/skipped counts

Kubernetes validation:
- rendered values
- ephemeral namespace/cluster
- image digest
- migration result
- probe result
- rollout or rollback result

Real-data acceptance:
- TEST_RUN_ID
- records created
- persisted values read back
- browser/API journey
- cleanup and verified absence

Security and data safety:
- secrets exposure check
- backup status for migration-bearing work
- tenant-isolation status when applicable

Commit:
- local commit hash and message

Remaining risks or blockers:
- explicit list or `none`

Do not claim that CI/CD, rollback, E2E, production, or multi-user isolation works unless it was actually executed in the relevant environment.

11. Immediate first instruction to follow

Begin with Stage 0 only.

Do not implement feature stages yet. Inspect the current repository, CI workflow, Helm chart, Argo CD Application, application architecture, database schema, migrations, test suite, and documented backup/restore process.

Produce the verified baseline, identify contradictions and risks, write the four ADR drafts, run the current real local and Kubernetes smoke tests, and stop.

Do not begin Stage 1 until Stage 0 is reviewed and explicitly approved.