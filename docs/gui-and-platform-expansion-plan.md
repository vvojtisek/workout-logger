# Plan: from workout logger to health platform — GUI input, modern shell, and breadth

## Context

You cannot create a workout plan from the GUI. **This is not a backend gap.** `POST /api/v1/plans`,
`PUT /api/v1/plans/{id}` and `DELETE` all exist and are fully validated
(`app/api/v1/plans.py`, `app/services/plans.py`, `app/schemas/plans.py`). The UI at
`app/static/app.js:148` only *lists*, *starts* and *deletes* plans — there is no create form and no
edit form anywhere in the 800-line `app.js`. Plans can currently only be created with `curl` or
through `/docs`.

The "minimalist graphics" have a concrete cause too: the entire design system is five `@apply`
rules in `frontend/input.css` (`.nav-btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`,
`.btn-danger-sm`). There are no tokens, no dark mode, no elevation, no type scale.

Beyond that, your spec (programs/calendar, nutrition, biometrics, sleep, MCP, Health Connect) is
roughly 12 vertical slices of work. `AGENTS.md` requires one slice per PR, tests written first, and
real-database E2E evidence — so this plan is a slice sequence, not one change.

**Decisions taken (yours, this session):**
- Migrate the frontend to React + Vite + TypeScript. This is the "separate approved decision" that
  `AGENTS.md:18` and `docs/active-workout-feature-plan.md:31` require. **`AGENTS.md` must be edited
  in Slice 1 to record it**, or every later slice violates the repo's own rules.
- Sequencing: unblock → redesign → breadth.
- Health Connect via authenticated REST ingest endpoints fed by a third-party Android app; no
  companion app for now.
- Stay single-user, add scoped tokens. **You expect 5–6 users later** — so every new table from
  Slice 5 onward carries a nullable `owner_id` from day one, making the multi-user migration
  additive instead of a rewrite.

### What already exists and must be reused, not rebuilt

| Asset | Path | Reuse |
|---|---|---|
| Pure workout logic (grid build, superset grouping, progress, suggestion state) | `app/static/workout-utils.js` | Port to `.ts` verbatim — no logic change. Unit tests in `frontend/workout-utils.test.js` come with it. |
| Offline draft + idempotent write queue + rest-timer math | `app/static/active-workout-state.js` | Same. This is the seed of the offline-first layer; do not write a second one. |
| Full plan CRUD API | `app/api/v1/plans.py` | Slice 2 needs **zero** backend work. |
| Active-session engine (sets, focus, rest, complete, optimistic version) | `app/services/workout_sessions.py`, 9 endpoints | Untouched by the migration. |
| Model primitives: `GUID`, `UTCDateTime`, `TimestampMixin`, `UUIDPrimaryKeyMixin` | `app/models/base.py` | Every new table uses these. |
| Schema primitives: `OrmModel`, `PaginatedResponse[T]`, `ErrorResponse`, `require_non_empty`, `require_timezone_aware_utc` | `app/schemas/common.py` | Every new schema uses these. |
| `NotFoundError` / `ConflictError` + registered handlers | `app/exceptions.py` | Every new service uses these. |
| Sleep + nutrition table designs, already specified | `docs/health-tracker-implementation-instructions.md` §4.5, §4.6 | Implement as written; do not redesign. |

### Three blockers your spec hits that are invisible from the outside

1. **CSP forbids half of section 3 and 4.** `app/main.py:36` sets `script-src 'self'; style-src
   'self'; img-src 'self' data:; connect-src 'self'` with no `frame-src` or `media-src`, and
   `Permissions-Policy: camera=(), microphone=(), geolocation=()`. That blocks the **YouTube embed**,
   the **barcode scanner camera**, **Google Fonts**, and any **outbound call to a food database**.
   `tests/test_static_pwa.py` asserts these headers. Each is a deliberate, separately-tested
   relaxation — never a quiet edit.
2. **Tailwind's content glob is `["./app/static/index.html", "./app/static/app.js"]`**
   (`tailwind.config.js:3`). Classes written in any *other* file produce no CSS, silently. Vite
   removes this trap.
3. **The Dockerfile CSS stage hardcodes the two file names** (`Dockerfile:8-11`). It must become a
   real `npm run build` in Slice 1 or images ship a stale stylesheet.

---

## Slice 1 — React/Vite/TS foundation + design system + 1:1 port

Branch `claude/workout-gui-input-buttons-f3vfmv` (this branch). No new user features.

Doing the migration *before* the plan builder costs one mechanical slice, but writing the builder in
vanilla and porting it two weeks later is throwaway work. The design system lands here because the
port already touches every screen.

**Stack:** Vite 7, React 19, TypeScript strict, React Router, TanStack Query (server state,
retries, optimistic mutations), Zod (parse API responses at the boundary), `vite-plugin-pwa`
replacing the hand-written `app/static/sw.js`, Tailwind v4 via `@tailwindcss/vite` (CSS-first
tokens, kills the content-glob trap).

**Layout:**
```
frontend/
  src/
    main.tsx  app.tsx  router.tsx
    api/client.ts          # port apiFetch from app.js:37, + Zod schemas
    lib/workout-utils.ts   # verbatim from app/static/workout-utils.js
    lib/active-workout-state.ts
    ui/                    # Button Card Field Input Select Sheet Dialog Tabs Toast EmptyState Skeleton
    features/{plans,active-workout,history,settings}/
    styles/tokens.css
```

**Design direction** (this is the "modern, elegant, responsive" answer):
- Semantic CSS custom properties only — `--bg`, `--surface`, `--surface-raised`, `--border`,
  `--text`, `--text-muted`, `--accent`, `--success`, `--warn`, `--danger`. Light and dark defined at
  `:root` / `@media (prefers-color-scheme: dark)`, plus a `[data-theme]` override so Settings can
  force one. No raw `slate-900` in components.
- One accent hue, used for the primary action and progress only. Everything else is neutral —
  that's what reads as elegant rather than a rainbow of Tailwind palette classes.
- 4px spacing scale, `border-radius` 8/12/16, borders over shadows, one elevation step.
- Self-host **Inter variable** in `app/static/fonts/` — `style-src 'self'` blocks Google Fonts, and
  the CSP stays as-is. `font-variant-numeric: tabular-nums` on every metric so weights don't jitter.
- Bottom tab bar < `md` with `env(safe-area-inset-bottom)`; left rail ≥ `md`. Keep the existing
  48×48px touch-target rule from the active-workout slices.
- Active workout keeps the sticky rest bar and hides global nav (per
  `docs/active-workout-feature-plan.md:251`).

**Serving:** Vite builds to `app/static/dist/`; FastAPI mounts it and gains a SPA catch-all that
returns `index.html` for non-`/api`, non-`/static`, non-`/health` paths (`app/main.py:157`).
`Dockerfile` stage 1 becomes `COPY frontend/ tailwind.config.* vite.config.ts` + `npm run build`.

**Ported 1:1:** Settings/API key, Plans list, New Workout (manual log), History, Detail, Active
Workout. Same behaviour, new look.

**Tests:** existing `frontend/*.test.js` must pass unchanged against the ported modules (this is the
proof the port is faithful). Existing Playwright specs in `e2e/` use role/text selectors and must
stay green — treat any spec change as a signal the port drifted. Add a `tests/test_static_pwa.py`
case asserting the SPA catch-all and that the built bundle is served.

---

## Slice 2 — Program builder: the missing buttons

The thing you actually asked for. **No backend changes.**

- Plans list gains a primary "New program" action and a per-card "Edit" / "Duplicate".
- Full-screen builder route `/plans/new` and `/plans/:id/edit`, driven by `WorkoutPlanCreate`:
  name, description, then a list of exercise rows — name, target sets, reps min/max, target weight,
  rest seconds, notes.
- Superset support surfaces the existing `group_key` / `group_order` columns
  (`app/models/plan_exercise.py:41`): rows can be linked into a group and render as `1A` / `1B`,
  matching `groupSessionExercises()` in the active-workout screen.
- Reorder rows (keyboard-accessible drag, not drag-only) → sends `sort_order` implicitly via array
  index, which `create_plan` already does (`app/services/plans.py:41`).
- Client-side Zod mirror of the server rules — `target_reps_max >= target_reps_min` is a server
  `model_validator` today and currently surfaces as a raw 422 alert.
- Duplicate = `GET` then `POST` with `name + " (copy)"`; handle the `PLAN_NAME_CONFLICT` 409 inline
  instead of `window.alert`.
- Replace the remaining `window.alert` / `window.confirm` calls with the new Toast/Dialog primitives.

**Tests:** Playwright journey creating a two-exercise plan with a superset through the real UI,
reading it back through the API, editing it, and deleting it with `TEST_RUN_ID` cleanup — per
`AGENTS.md:13-15`.

---

## Slice 3 — Exercise kinds and the dynamic grid (spec §3)

Additive migration. `exercise_kind` (`strength|bodyweight|cardio`, default `strength`) on
`plan_exercises` and `session_exercises`; kind-specific nullable columns on `set_entries`:
`added_weight_kg`, `band_level`, `duration_seconds`, `distance_km`, `incline_percent`, and `rpe`
alongside the existing `rir`.

Frontend: `buildWorkoutGrid()` gains a column set per kind so the grid renders
Weight/Reps/RPE, Added-weight/Reps/Band, or Time/Distance/Pace/Incline. Rest-timer quick adjust
becomes ±15s per your spec (currently ±30s, `app/static/index.html:75`) and configurable in Slice 12.

---

## Slice 4 — Exercise catalogue and guide view (spec §3, media)

Implements `docs/active-workout-feature-plan.md` Slice 5: catalogue with aliases, validated media
URL, primary/secondary muscle tags, ordered instruction steps.

**CSP decision required.** Default to **link-out + self-hosted MP4** on the `/data` volume, which
needs no CSP change. If you want inline YouTube, add `frame-src https://www.youtube-nocookie.com`
behind a config flag and update `tests/test_static_pwa.py` explicitly.

---

## Slice 5 — Programs and calendar scheduling (spec §2)

New tables (all with `owner_id` nullable from the start):
- `programs` — name, kind, `start_date`, `end_date` nullable, status, notes.
- `scheduled_workouts` — `program_id`, `workout_plan_id`, `scheduled_date`, status
  (`scheduled|in_progress|completed|skipped`), `workout_session_id` nullable.

Deliberately **no** unique constraint on `(owner, date)` — that is what makes concurrent and
overlapping blocks (Hockey Pre-Season + Hypertrophy) work.

API: CRUD on both, plus `GET /api/v1/calendar?from=&to=` returning a bounded date range (never an
unbounded history query — `docs/active-workout-feature-plan.md:253`). Injecting/rescheduling by JSON
payload is just `POST`/`PATCH` on `scheduled_workouts`, which also gives the MCP server its tool.

UI: month and week views, tap a day to schedule, drag to move, status chips, and a "Start" action
that hands off to the existing `POST /api/v1/workout-sessions`.

---

## Slice 6 — Biometrics and progress photos (spec §5)

`body_metrics`: `measured_at`, `weight_kg`, `body_fat_percent`, and neck/chest/waist/hips/biceps/
forearms/thighs/calves. Rolling 7- and 14-day deltas are **computed in a service, not stored**
(same rule as the dashboard read model, doc §4.7).

Progress photos are a **separate follow-up slice** — binary storage needs its own decision. The
recommendation is files under the existing `/data` PVC (`photos/{uuid}.jpg`), path in the DB, served
by an authenticated endpoint. Never blobs in SQLite; the backup/restore scripts in `scripts/` copy
the DB file only.

---

## Slice 7 — Nutrition core (spec §4)

Implement `docs/health-tracker-implementation-instructions.md` §4.6 exactly: `foods`,
`nutrition_plans` (targets), `meal_entries`, `meal_items` **with snapshot columns** so later
catalogue edits never rewrite history. Recipe builder = a `food` composed of ingredient rows.
Daily dashboard with macro dials + supplement checklist. Batch logging is `POST /api/v1/meal-entries`
accepting an array.

**Barcode scanning is its own slice**, because it needs three separate changes: `Permissions-Policy:
camera=(self)`, a locally-bundled scanner (`script-src 'self'` forbids a CDN; a wasm decoder likely
needs `wasm-unsafe-eval`), and UPC resolution — which must go through a **server-side proxy** to
Open Food Facts so `connect-src 'self'` stays intact and no key reaches the browser.

---

## Slice 8 — Sleep (spec §6)

`sleep_entries` per doc §4.5 — manual summary entry first, exactly as that document instructs.
Ingestion arrives with Slice 11.

---

## Slice 9 — Scoped tokens (spec §7, prerequisite for §1)

`api_tokens`: name, hashed secret, scopes (`read`, `log`, `admin`), `last_used_at`, `revoked_at`.
`app/security.py:11` keeps accepting the bootstrap `API_KEY` from config, and additionally resolves
DB tokens. The MCP agent gets `read`+`log`; your phone gets `admin`.

This is where multi-user readiness gets locked in: tokens carry a nullable `owner_id`, and the
5–6-user migration later becomes "add a `users` table and backfill", not a rewrite of every endpoint.

---

## Slice 10 — MCP server (spec §1)

Mount **FastMCP** (streamable HTTP) at `/mcp` inside the same FastAPI app — one deployable, per the
modular-monolith decision in doc §3.1. Tools call `app/services/*` directly, not the HTTP layer:
`list_programs`, `get_plan`, `create_plan`, `schedule_workout`, `log_set`, `log_meal`,
`log_biometrics`, `get_daily_summary`. Auth via a Slice 9 scoped token. Note the existing
`ACTION_PATH_ALIASES` in `app/main.py:20` — the app already serves an agent-style client; keep it.

---

## Slice 11 — Health ingest (spec §1)

`POST /api/v1/ingest/{weight|steps|sleep|sessions}` with `source` and `external_id`, unique together
for idempotency — so a re-sync never duplicates. Document the recipe for Health Sync / Tasker /
HTTP Shortcuts on Android in `docs/`. A companion Kotlin app stays deferred.

---

## Slice 12 — Settings, export, offline generalization (spec §7, §1)

Units toggle (metric/imperial), default rest per movement type (compound vs isolation), token
management UI, MCP runtime status, and `GET /api/v1/export?format=json|csv`.

Also here: generalize the localStorage write queue in `active-workout-state.js` to IndexedDB behind
TanStack Query optimistic mutations, per domain. Explicitly **not** a general-purpose sync
framework — `docs/active-workout-feature-plan.md:199` warns against exactly that.

---

## Verification

Every slice runs the full `AGENTS.md` gate before the PR leaves draft:

```bash
pytest --cov=app --cov-report=term-missing
ruff check --select E4,E7,E9,F .     # required gate; `ruff check .` informational (issue #28)
ruff format --check .
mypy app/
npm ci && npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e                     # against a real server + real SQLite file
helm lint helm/workout-logger
helm template workout-logger helm/workout-logger | kubeconform -strict
```

Slice-specific evidence:
- **Slice 1:** existing `frontend/*.test.js` pass unmodified against ported modules; all existing
  `e2e/*.spec.js` pass unmodified; `docker build .` produces an image serving the built SPA.
- **Slice 2:** a Playwright journey creates a superset plan **through the GUI**, verifies it via
  `GET /api/v1/plans/{id}`, starts a session from it, then deletes and proves absence — no route
  interception, per `AGENTS.md:14`.
- **Migrations:** `tests/test_migrations.py` already round-trips schema; extend it per new revision.
- **CSP:** any relaxation in Slices 4/7 needs an explicit assertion in `tests/test_static_pwa.py`
  naming what is now allowed and what still is not.

## Housekeeping this plan requires

- First action after approval: commit this plan itself as `docs/gui-and-platform-expansion-plan.md`
  on `claude/workout-gui-input-buttons-f3vfmv` (its own commit, before any code change), so the
  decisions above are reviewable in the repo alongside `docs/active-workout-feature-plan.md` and
  `docs/health-tracker-implementation-instructions.md`.
- Edit `AGENTS.md:18` and `docs/active-workout-feature-plan.md:31` in Slice 1 to record the approved
  React/Vite decision — otherwise every later slice contradicts the repo's stated rules.
- Open one GitHub issue per slice; PRs stay draft until the gate is green (`AGENTS.md:8-11`).
- `app/static/styles.css` is a generated file that is committed; after Slice 1 it is replaced by
  `app/static/dist/` and should be git-ignored.
- Issues #28 (Ruff baseline) and #2 (CD rollback) stay out of these PRs, per `AGENTS.md:19`.
