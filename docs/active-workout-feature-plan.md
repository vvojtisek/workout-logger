# Feature-first implementation plan: active workout experience

Status: proposed  
Base reviewed: `main` at `739ad2dad49c8d3f90d6a114f62ed393b5add1f6`  
Planning branch: `plan/feature-first-active-workout`

## 1. Purpose and precedence

This plan is the immediate delivery authority for the requested workout screens and workout-tracking flow. For this work it supersedes the sequencing in sections 8 and 11 of `docs/health-tracker-implementation-instructions.md`.

The older document remains the long-term health-platform roadmap, but its architecture, CI/CD, PostgreSQL, multi-user, sleep, and nutrition stages are **not prerequisites** for the active-workout MVP.

The next objective is working product functionality:

- start or resume a planned workout with at most two actions;
- always show the current exercise, set, and next action;
- record a correctly prefilled set with one action;
- start the exercise-specific rest timer automatically;
- retain progress after reload, backgrounding, or a temporary network interruption;
- finish the workout and see the result in history and the dashboard.

## 2. Why the previous strategy stalled

The previous sequence put platform stabilization and a frontend rewrite before the user journey. That produced useful reliability work but little visible feature value.

This plan changes the execution model:

1. Deliver thin end-to-end slices through database, API, UI, and browser tests.
2. Merge each usable slice before expanding it.
3. Keep the existing FastAPI, SQLite, vanilla JavaScript, Tailwind, Helm, and Argo CD stack for the MVP.
4. ~~Do not begin a React/Vite migration during this plan.~~ **Superseded.** Slices 1–3 shipped on the vanilla stack as written. The migration to React 19 + Vite + TypeScript was then approved separately and delivered as Slice 1 of `docs/gui-and-platform-expansion-plan.md`, which carried the active-workout screens over unchanged — every unit and browser test in this plan's gate passed without modification.
5. Treat open deployment issue #2 as a separate track. It must not block feature PRs unless CI cannot safely validate or promote them.
6. Create follow-up issues for unrelated defects instead of fixing them inside feature PRs.

## 3. Branch and pull-request strategy

Do not implement the entire roadmap in one long-lived branch.

1. Merge this planning branch into `main`.
2. Create one GitHub issue for each slice below.
3. Create each implementation branch from the latest green `main`:
   - `feat/active-workout-walking-skeleton`
   - `feat/active-workout-grid`
   - `feat/rest-timer-resilience`
   - `feat/workout-overview`
   - `feat/exercise-detail`
   - `feat/fitness-dashboard`
4. Open a draft PR immediately and keep its scope limited to one slice.
5. Use Conventional Commits, for example `feat(workout): persist active sessions`.
6. Merge only after all slice gates pass. Delete the branch, update the issue, and create the next branch from the new `main`.
7. Never stack several unmerged feature branches on each other.

Maximum intended PR size is roughly 500 changed production lines, excluding generated CSS, migrations, and tests. If a slice exceeds that, split it vertically while keeping each part deployable.

## 4. Scope control

### Included

- active workout session lifecycle;
- per-set logging of weight, repetitions, and RIR/effort;
- previous-performance suggestions;
- automatic rest timing, adjustment, and skip;
- set edit and five-second undo;
- progress and current/next exercise behavior;
- linked/superset presentation;
- plan overview/start/resume screen;
- exercise detail screen with media, muscle tags, and instructions;
- fitness dashboard cards and global bottom navigation;
- responsive, accessible PWA behavior;
- real-database integration and browser journeys.

### Explicitly deferred

- React/Vite migration;
- sleep and nutrition modules;
- PostgreSQL;
- family accounts and multi-tenancy;
- Argo Rollouts, blue/green, canary, and zero-downtime work;
- wearable integrations;
- advanced analytics and social features.

Deferred items may receive issues, but they must not expand the feature PRs.

## 5. Data and API direction

Use additive migrations and preserve the current plan/log API.

### New active-session model

Introduce dedicated active-session tables rather than inserting incomplete rows into the current `workout_logs` table:

- `workout_sessions`
  - id, source_plan_id, source_plan_name;
  - status: active, completed, cancelled;
  - started_at, completed_at;
  - focused_exercise_id and focused_set_number;
  - rest_ends_at as an absolute UTC timestamp;
  - version for optimistic concurrency.
- `session_exercises`
  - session_id and stable sort order;
  - snapshot of exercise name, targets, rest seconds, and notes;
  - optional exercise-catalog id;
  - optional group key/order for supersets;
  - status.
- `set_entries`
  - session_exercise_id and set number;
  - weight_kg, reps, rir;
  - state: planned, completed, skipped;
  - completed_at;
  - client_operation_id with a unique constraint for idempotency.

Snapshot the plan when the session starts so later plan edits cannot change an in-progress workout.

On workout completion, transactionally create or update the existing `WorkoutLog`/`ExerciseLog` compatibility summary so current history consumers continue to work. Do not create a legacy log with fake duration or feeling values when a session merely starts. The richer set data remains authoritative in the session tables until the history model is intentionally upgraded.

### Initial API surface

- `POST /api/v1/workout-sessions` — start from a plan; return an existing active session for the same plan unless restart is explicitly requested.
- `GET /api/v1/workout-sessions/active` — return the resumable session.
- `GET /api/v1/workout-sessions/{id}` — complete session snapshot for rendering.
- `POST /api/v1/workout-sessions/{id}/sets` — idempotently complete a set and start rest.
- `PUT /api/v1/workout-sessions/{id}/sets/{set_entry_id}` — correct a saved set.
- `DELETE /api/v1/workout-sessions/{id}/sets/{set_entry_id}` — undo/remove a set.
- `PATCH /api/v1/workout-sessions/{id}/focus` — explicit exercise/set navigation.
- `PATCH /api/v1/workout-sessions/{id}/rest` — add/subtract time or skip.
- `POST /api/v1/workout-sessions/{id}/complete` — finalize and produce history compatibility data.
- `POST /api/v1/workout-sessions/{id}/cancel` — explicit cancellation without deleting audit data.

The server is authoritative for saved sets, focus, and `rest_ends_at`. The browser calculates displayed remaining time from the absolute timestamp; it must not depend on an interval counter surviving backgrounding.

## 6. Delivery slices

### Slice 0 — Preflight only

Time limit: 60 minutes. No architectural cleanup.

- Confirm current `main` CI is green.
- Run the existing backend, frontend, manifest, and E2E commands.
- Record the current API/schema behavior affected by Slice 1.
- Create the six feature issues and start Slice 1.

Exit gate: existing tests pass, or a blocking failure is documented in one issue. Do not turn Preflight into a repair sprint.

### Slice 1 — Active-workout walking skeleton

Deliver the smallest genuinely usable path:

1. Select an existing plan.
2. Start a session.
3. Show one current exercise and set.
4. Prefill values from the plan or latest compatible history as visibly unsaved suggestions.
5. Save the set once.
6. Persist the session and absolute rest end time.
7. Reload the page and resume the same session with the saved set and timer.
8. Complete the session and verify it appears in existing history.

Required tests written first:

- backend integration: start, duplicate-start behavior, set idempotency, reload/read, and completion;
- migration test against a copy of the current schema;
- frontend unit tests for suggestion-versus-saved state and remaining-time calculation;
- Playwright journey through the real HTTP API and a real SQLite file.

Exit gate: the browser journey creates a real plan/history fixture, starts and resumes a session, completes it, reads it from history, deletes all generated records, and verifies their absence.

### Slice 2 — Full logging grid and workout progression

Deliver the active logging screen:

- all planned exercises and sets;
- columns for set number, previous result, kg, reps, RIR, and completion;
- numeric inputs suitable for a phone keyboard;
- minimum 48 × 48 px touch targets;
- completed, current, skipped, and future states;
- progress header and Finish action;
- automatic focus on the next incomplete set;
- five-second Undo plus permanent edit;
- collapsible linked/superset groups;
- incomplete-workout confirmation before finish.

Do not add charts or exercise media in this slice.

Exit gate: Playwright completes a multi-exercise workout including different weights per set, undo, correction, skip, and a superset group; exact values are verified through the API and database-backed read endpoints.

### Slice 3 — Rest timer and resilience

Deliver the timer-state behavior:

- sticky bottom timer overlay;
- exercise-specific automatic rest time;
- +30 seconds, −30 seconds, and Skip;
- timer derived from `rest_ends_at`;
- correct recovery after reload and simulated background time;
- non-blocking access to correct the just-saved set;
- local draft retention for unsaved numeric input;
- idempotent queued set submission after a temporary network failure;
- clear pending/synced/error state, without duplicate set entries.

Do not build a general-purpose offline synchronization framework. Implement only the active-workout operations required here.

Exit gate: browser tests use the real server, deliberately interrupt requests, reload, advance time, reconnect, and prove exactly one persisted set with the correct timer state.

### Slice 4 — Workout overview and planning screen

Deliver:

- top header;
- horizontally scrollable metric widgets for planned exercises, sets, estimated time, and recent completion;
- vertical exercise list with titles and parameters;
- nested/collapsible superset groups;
- optional thumbnail with a stable placeholder;
- sticky primary Start/Resume CTA;
- secondary Edit/Back action;
- protection against accidentally starting duplicate sessions.

Exit gate: a real plan containing standalone and grouped exercises renders correctly, starts once, resumes after navigation, and retains the snapshot if the source plan is edited afterward.

### Slice 5 — Exercise detail screen

Add an exercise catalogue without blocking free-text legacy plans:

- exercise name and optional aliases;
- validated HTTPS media URL/provider;
- primary and secondary muscle tags;
- accessible muscle visualization with textual equivalent;
- ordered instruction steps;
- optional equipment and safety notes;
- plan exercises may reference a catalogue exercise but retain the name snapshot.

UI requirements:

- header and tabs;
- responsive, privacy-aware embedded media container;
- muscle graphic and categorized badges;
- vertically readable ordered instructions;
- useful empty states when media or muscle data is absent.

Exit gate: catalogue CRUD and detail rendering use real API records; unsafe media URLs are rejected; keyboard and screen-reader semantics are tested; generated records are deleted.

### Slice 6 — Fitness dashboard and navigation

Deliver a bounded fitness dashboard, not the future multi-domain health dashboard:

- active-session Resume card first when applicable;
- today's workout status;
- recent volume/session count;
- simple trend indicator based only on stored data;
- next planned workout;
- modular loading, empty, offline, and error states;
- fixed bottom icon-text navigation;
- active-workout route hides global navigation so logging controls retain space.

Create one `GET /api/v1/dashboard/today` endpoint to avoid many sequential mobile requests. Bound every history query by date/range.

Exit gate: dashboard values are verified against known real records before and after completing a workout, and the Resume CTA opens the exact active session.

### Slice 7 — Release hardening

- responsive checks at representative small phone, large phone, tablet, and desktop viewports;
- keyboard and accessibility scan;
- PWA install/update smoke test;
- measured initial bundle, API count, and dashboard response size;
- full k3d ephemeral deployment with real SQLite PVC;
- upgrade with an active session preserved;
- production promotion through the existing immutable-digest GitOps process;
- tagged production smoke data only if safe, followed by deletion and verified absence.

This slice may optimize measured problems. It must not introduce a framework rewrite.

## 7. Test policy: real data, not mock success

Mocks are allowed only for isolated unit tests of pure logic or deliberately forced error paths.

Integration and E2E acceptance must use:

- the real FastAPI application;
- the real SQLAlchemy repositories and migrations;
- a real temporary SQLite database file;
- real HTTP requests;
- the actual browser JavaScript;
- an ephemeral k3d/k3s deployment and PVC for the release gate.

Every E2E run must generate a unique `TEST_RUN_ID`, include it in record names/notes, and perform cleanup in a `finally` block. Cleanup must query the API afterward and prove that the records no longer exist. On failure, preserve diagnostics before cleanup.

Do not call JSON fixtures returned from route interception “integration” or “E2E.” Browser network mocking is prohibited in acceptance journeys.

## 8. Required gate for every slice

Tests must be written first and observed failing for the intended reason. Then implement only enough to pass.

Run all commands that exist in the repository:

```bash
pytest --cov=app --cov-report=term-missing
ruff check --select E4,E7,E9,F .
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
```

For active-workout slices, `ruff check --select E4,E7,E9,F .` is the required Ruff gate because
it matches the authoritative green CI baseline. Run `ruff check .` informationally as a baseline
ratchet: newly created Python files must pass the full Ruff rules, no new violations may be
introduced, and the known baseline must not get worse. Issue #28 documents the pre-existing
50-violation mismatch and is non-blocking; do not modify unrelated files merely to reduce it.

Also run the repository's Kubernetes schema, security, SBOM, container, and ephemeral-cluster gates through CI.

A slice cannot merge with failed tests, unexplained skips, flaky reruns, reduced validation, browser route interception, or unverified cleanup.

## 9. Loop protection and escalation

For one failing root cause:

1. Attempt 1: reproduce, collect exact evidence, apply the smallest fix.
2. Attempt 2: reassess the root cause from logs, test isolation, state, and environment.
3. Attempt 3: use a different diagnostic approach; do not repeat the same change.

After three failed attempts, stop changing code. Report:

- failing command and exact error;
- three attempted fixes and evidence;
- current diff and whether it is safe to retain;
- likely root cause;
- smallest user decision or access requirement needed.

Do not weaken, skip, delete, or rewrite a legitimate failing test to escape the gate.

## 10. Definition of success

This plan succeeds when a user can:

1. open the PWA;
2. start a planned workout in at most two actions;
3. see the current exercise and next set immediately;
4. accept suggested values and save a set in one action;
5. see an automatic rest timer and adjust or skip it;
6. resume after reload or network interruption without duplicate data;
7. progress through grouped exercises;
8. complete the workout;
9. see correct history and dashboard results.

The result must be demonstrated with persisted records through the real application stack, not screenshots or mocked responses.
