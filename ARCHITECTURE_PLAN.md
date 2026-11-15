# AI coach longevity loop: architecture plan

Status: plan for branch `feat/ai-coach-longevity-loop`, written before any
application code changed. Baseline: `main` at 8ac5444, Alembic head
`c3a8f2e6b1d4`, 747 backend tests green.

The goal is one loop: an assistant (Claude, ChatGPT, Gemini) reads a compact
coaching context, writes back a day's meals, supplements and a gym session,
and the phone app turns those writes into one-tap actions (cook, shop, eat,
train, check in). The app's own rules stay deterministic; the assistant
plans, the app executes and records.

## 1. Current state (audit)

| Area | What exists | Where |
| --- | --- | --- |
| Storage | SQLite (aiosqlite, WAL, single writer), Alembic, 41 revisions. No PostgreSQL in use. | `app/database.py`, `alembic/` |
| Ownership | Every personal table carries `owner_id`. A session-level ORM hook scopes reads and fills `owner_id` on insert from `session.info["data_owner_id"]`, set by `require_api_key`. | `app/database.py`, `app/security.py`, `docs/account-data-ownership.md` |
| REST auth | `X-API-Key` (bootstrap `API_KEY` = global admin, or hashed DB `api_tokens` with `read`/`log`/`admin` scopes, owner-scoped) or the session cookie. | `app/security.py` |
| MCP | FastMCP 4.1 streamable HTTP at `/mcp/`, 34 CRUD tools, OAuth 2.1 via Auth0 proxy (or JWT verifier in tests), subject allowlist, per-tool `read`/`log` scopes, 72 h audit log. Mounted only when `MCP_OAUTH_ENABLED`. Tool DB sessions are **not** owner-scoped (`docs/account-data-ownership.md`), which is why MCP is still off in production. | `app/mcp/` |
| OpenAPI | FastAPI 3.1 schema at `/openapi.json`, stable `operationId`s, `X-API-Key` scheme, `PUBLIC_BASE_URL` server, `/workout-plans` and `/workout-logs` aliases for GPT Actions. About 130 operations. | `app/main.py`, `tests/test_openapi.py` |
| Training | Plans (`workout_plans`/`plan_exercises` with target sets, rep range, RIR, weight), programs + `scheduled_workouts`, live `workout_sessions`/`session_exercises`/`set_entries`, completed `workout_logs`/`exercise_logs` (per-set weight/RIR/RPE), non-gym activities on `workout_logs.activity_type` (`ice_hockey`, `swimming`, ...) with session RPE, training-load service (sRPE, ACWR). | `app/models`, `app/services/training_load.py` |
| Progression | Fixed double-progression rules over the last 2 sessions of an exercise; result stored on `session_exercises.suggested_weight_kg/reps/source/note` at session start. | `app/services/progression.py`, `app/services/next_session.py` |
| Context data | Locations with equipment tags, hockey `load_events` with heavy-legs warning, shared admin `coaching_principles` text, sleep entries (quality 1-5), body metrics, Health Connect ingest. | various |
| Nutrition | Foods (per serving), `meal_entries`/`meal_items` with macro snapshots, `nutrition_plans` = date-ranged daily macro targets, daily summary, quick-add drink presets. | `app/services/nutrition_*` |
| Phone UI | React 19 + Vite + TS + Tailwind. Phone lands on `/today` (coach card, hockey confirm, sleep confirm, food card). Live workout HUD pre-fills from `suggested_*` and shows "Last session: 70.0 kg × 8". Desktop keeps master-detail pages. | `frontend/src` |

## 2. Gaps against the request

1. No subjective readiness record (soreness, muscle tags, fatigue, sleep
   quality, prior-day strain, physical constraints) and nothing that feeds it
   into load suggestions.
2. No athlete profile: goals, hard dietary exclusions and physical
   constraints have nowhere to live, so an assistant cannot read them first.
3. Nutrition plans are macro targets only: no dated meals, ingredients,
   preparation steps, shopping list, or supplement schedule.
4. Plan exercises cannot say "the coach prescribed this, for this reason",
   and a session ignores plan weights once history exists.
5. No consolidated read for an assistant; it has to call 10+ list tools.
6. MCP needs OAuth, which Claude Code, Gemini CLI and scripts handle poorly,
   and MCP data access is unscoped.
7. The full OpenAPI schema is too large for a Custom GPT (the editor rejects
   more than 30 operations per action set, as far as I know; I could not
   check the current limit from here).
8. Quick activity logging needs 3-4 taps and a form; there is no shopping or
   cooking view.

## 3. Decisions on ambiguous or conflicting points

| # | Point | Decision | Why |
| --- | --- | --- | --- |
| D1 | Table names in the request (`nutrition_plans`, `meal_logs`, `workout_plans`, `exercise_targets`) collide with existing tables. | Reuse `meal_entries` as the meal log, `workout_plans`/`plan_exercises` as the prescription store (new columns), keep `nutrition_plans` as the long-range macro target. New tables use distinct names: `daily_meal_plans`, `planned_meals`, `planned_meal_ingredients`, `grocery_items`, `supplement_schedules`, `supplement_intakes`, `readiness_logs`, `athlete_profiles`. | "Preserve existing data and APIs." A second `exercise_targets` table would duplicate `plan_exercises` column for column. |
| D2 | `/openapi.json` "filtered for ChatGPT/Gemini". | `/openapi.json` stays the full schema (used by `/docs` and existing tests). The filtered Actions schema is served at `/openapi/actions.json`, at most 30 operations, `X-API-Key` only. | Filtering the main schema would break the docs page and existing clients. |
| D3 | "Gemini Extensions". | Documented as outdated: consumer Gemini has no way to add a third-party OpenAPI extension that I know of. Gemini CLI connects over MCP with an API key header; the Actions schema also works for any OpenAPI-capable agent. | Truthful docs over a payload nobody can paste. |
| D4 | MCP "Bearer/API-key auth" while OAuth exists. | Additive. New `MCP_API_KEY_AUTH_ENABLED` (default `false`). When on, `/mcp/` accepts the existing DB API tokens (`wl_...`) as `Authorization: Bearer wl_...` or `X-API-Key: wl_...`. Tokens starting `wl_` are checked against `api_tokens`; anything else goes to the unchanged OAuth verifier. The bootstrap `API_KEY` is **refused** on MCP. | Keeps OAuth exactly as is; the global admin key never reaches an LLM vendor. |
| D5 | MCP data scope. | API-token calls are scoped to the token's owner, exactly like REST. OAuth calls keep today's unscoped behaviour unless the new `MCP_OAUTH_ACCOUNT_EMAIL` names the account they act for. | Closes the ownership gap that keeps MCP off in production, without changing OAuth for existing setups. |
| D6 | SSE transport. | Served at `/mcp/sse` next to streamable HTTP at `/mcp/`, same auth. Marked legacy in docs. | SSE was deprecated by the MCP spec in 2025-03 in favour of streamable HTTP; some clients still use it. |
| D7 | Readiness modal asks for "energy", the data model asks for "fatigue". | Store `fatigue` 1-10 (10 = exhausted). The modal shows an Energy slider and stores `fatigue = 11 - energy`, a lossless mapping. | One field in the model; the phone asks the friendlier question. |
| D8 | Readiness scaling of loads. | Deterministic and small: a 0-100 score maps to a load factor of 1.00 / 0.95 / 0.90 / 0.85. Applied to history-based suggestions, and to coach targets only when the check-in is newer than the prescription. | See section 6 for the evidence caveat. |
| D9 | Coach prescriptions vs. the user's own plans. | A coach write creates or replaces its own plan (`workout_plans.origin = 'coach'`) scheduled on a date; it never edits the user's templates. A coach plan that was already started cannot be changed (409). | The user's plans are his; replaying a write is idempotent per (date, name). |
| D10 | Swim + sauna, sauna alone. | `workout_logs` gains `laps` and `sauna_rounds`; `activity_type` gains `sauna`. One tap on Swim + Sauna writes one swim log (30 min, 30 laps, 3 sauna rounds). | One record, one undo. Sauna has no session RPE, so it adds no training load. |
| D11 | Who may write hard dietary exclusions. | `athlete_profiles` is editable in Settings and `PUT /api/v1/profile` only; no MCP write tool and not in the Actions schema. | An assistant must never be able to drop an allergy. |
| D12 | Delivery shape. | One branch and one PR, commits in the requested order, as Vlad asked. This overrides the repository's "one PR per slice" rule in `AGENTS.md`/`CLAUDE.md` for this change. | Explicit instruction for this work. |
| D13 | Personal constraints (gluten, lactose, fish/seafood, mushrooms, cooked dill, chickpeas). | Not seeded by migration. The Settings profile form and the README show the exact payload. | Personal data stays out of the schema history; nothing is written to production by a deploy. |

## 4. Schema migrations

One Alembic revision on top of `c3a8f2e6b1d4`, additive only. Existing rows
are untouched; new columns are nullable or have server defaults. SQLite check
constraints are changed with `batch_alter_table` (table copy), the pattern the
earlier activity-fields migration used. Downgrade drops the new tables and
columns and restores the old check constraints (it fails loudly if a `sauna`
log or a `coach` suggestion exists, rather than deleting data).

New owned tables (added to `_OWNED_MODELS`, so REST/MCP scoping applies):

- `athlete_profiles`: `owner_id` (one row per owner, partial unique indexes
  as for other owned tables), `display_name`, `birth_year`, `longevity_goals`
  JSON `list[str]`, `dietary_constraints` JSON
  `list[{item, kind: allergy|intolerance|exclusion, severity: severe|strict|preference, note}]`,
  `physical_constraints` JSON `list[str]`, timestamps.
- `readiness_logs`: `owner_id`, `log_date`, `logged_at`, `soreness` 1-10,
  `sore_muscle_groups` JSON (the exercise catalogue's muscle tags), `fatigue`
  1-10, `sleep_quality` 1-10, `prior_day_strain` none|moderate|high,
  `strain_source` manual|derived, `physical_constraints` JSON `list[str]`,
  `notes`, `source` app|mcp|api, timestamps. Check: at least one of soreness,
  fatigue, sleep quality. Index `(owner_id, log_date)`.
- `daily_meal_plans`: `owner_id`, `plan_date` (unique per owner),
  `energy_target_kcal`, `protein_target_g`, `fiber_target_g`,
  `carbohydrate_target_g`, `fat_target_g`, `notes`, `source` coach|manual,
  timestamps.
- `supplement_schedules`: `owner_id`, `name`, `dose`, `unit`, `timing`
  morning|pre_workout|post_workout|with_meal|evening|bedtime, `applies_on`
  daily|training_days|rest_days|hockey_days, `notes`, `active`, timestamps.

Child tables (inherit access through the parent, cascade on delete):

- `planned_meals`: `day_plan_id`, `sort_order`, `meal_type`
  (breakfast|lunch|dinner|snack), `name`, `prep_steps` JSON `list[str]`,
  macros (`energy_kcal`, `protein_g`, `carbohydrate_g`, `fat_g`, `fiber_g`),
  `eaten_meal_entry_id` FK `meal_entries` SET NULL, unique.
- `planned_meal_ingredients`: `meal_id`, `sort_order`, `name`, `quantity`
  (> 0), `unit`, `note`, `food_id` FK `foods` SET NULL, `prepared` bool
  (kitchen checklist).
- `grocery_items`: `day_plan_id`, `name`, `name_key` (lower-cased), `unit`,
  `quantity`, `checked` bool, `sort_order`; unique `(day_plan_id, name_key, unit)`.
- `supplement_intakes`: `schedule_id`, `intake_date`, `taken_at`; unique
  `(schedule_id, intake_date)`.

Changed tables:

- `workout_plans.origin` user|coach, server default `user`.
- `plan_exercises`: `target_rpe` 1-10 (strength only), `coach_rationale`
  varchar(240), `target_source` user|coach (server default `user`).
- `session_exercises`: `suggestion_source` check adds `coach`;
  `coach_rationale` varchar(240); `readiness_factor` real.
- `workout_logs`: `activity_type` check adds `sauna`; `laps` int >= 0;
  `sauna_rounds` int 0-20.

Verification: `tests/test_migrations.py` gains a case that upgrades a database
holding a workout log, a live session and a plan from the previous head and
checks every row and value survives; the same is run against a copy of a real
database file locally (section 9).

## 5. Services

- `app/services/readiness.py`: create/list/delete; `derive_prior_day_strain`
  (yesterday's logs: ice hockey or session RPE >= 8 is high, any other
  activity or strength session is moderate); `readiness_score` and
  `load_factor` (section 6); `latest_for_session_start` (newest check-in in
  the last 18 hours, so a server without the user's time zone still picks
  this morning's).
- `app/services/athlete_profile.py`: get-or-empty and replace.
- `app/services/meal_plans.py`: `upsert_days` (one transaction for every day
  plus the supplement stack), grocery aggregation by `(name_key, unit)`
  summing quantities and keeping `checked` across re-plans, meal "eaten"
  (creates a `meal_entries` row whose items are the ingredients when every
  ingredient has macros, else one item carrying the meal's macros;
  idempotent; undo deletes that entry), kitchen `prepared` toggles,
  grocery check toggles over aggregated ids.
- `app/services/supplements.py`: replace the active stack by name and timing
  (missing ones become inactive, history kept), list due for a date (training
  day = a scheduled workout, a logged strength session, or a hockey load
  event that day), mark taken/untaken.
- `app/services/coach_workouts.py`: `upsert_adaptive_workout_plan`.
- `app/services/exercise_baseline.py`: last 3-5 completed sessions of an
  exercise (date, sets x reps @ kg, best set, Epley e1RM), the
  double-progression suggestion, the readiness factor, and the adjusted
  suggestion. `next_session.HISTORY_SESSIONS` goes from 2 to 5; the rules
  still read only the newest two, so existing suggestions do not change.
- `app/services/coach_context.py`: the consolidated payload (section 7).
- `app/services/quick_log.py`: activity defaults and the combined
  readiness + activity write used by REST, MCP and the phone.
- `workout_sessions.start_session`: for each exercise, a coach target wins
  over history (`suggestion_source = 'coach'`, note from the rationale);
  otherwise the history suggestion is scaled by the readiness factor and the
  note says why, for example `Adjusted -10% for post-hockey recovery`.

## 6. Readiness score (and how much to trust it)

Each present component maps to 0..1 and is weighted; absent components are
dropped and the weights renormalised:

| Component | Mapping | Weight |
| --- | --- | --- |
| Soreness 1-10 | (10 - s) / 9 | 0.30 |
| Fatigue 1-10 | (10 - f) / 9 | 0.30 |
| Sleep quality 1-10 | (q - 1) / 9 | 0.25 |
| Prior-day strain | none 1.0, moderate 0.7, high 0.4 | 0.15 |

Score = round(100 x weighted mean). Load factor: >= 75 → 1.00, 60-74 → 0.95,
45-59 → 0.90, < 45 → 0.85. When a sore muscle group (soreness >= 7) is a
primary muscle of the exercise, a further 0.05 comes off. Loads are rounded
to the exercise's increment (rounding down on a tie). Reps and sets are not
cut automatically.

Evidence, stated plainly: self-reported wellness (soreness, fatigue, sleep)
tracks training load and recovery better than most objective markers in
group studies (Saw et al., 2016, systematic review), and RIR/RPE-based
autoregulation is reasonably supported for strength. The specific weights,
thresholds and 5-15 % cuts above are **not** validated; they are a
conservative heuristic in that spirit, fixed in code, readable over MCP
(`get_progression_rules` gains them), and easy to change. RIR logged during
the session remains the stronger signal.

## 7. Integration layer: tool and endpoint signatures

All REST routes are under `/api/v1`, behind `require_api_key` (cookie or
`X-API-Key`), `read` scope for GET and `log` for writes. MCP tools call the
same services with the same Pydantic models.

| MCP tool | REST | Scope | Purpose |
| --- | --- | --- | --- |
| `get_coaching_context(days=7)` | `GET /coach/context?days=7` (1-28) | read | Everything below in one call. |
| `log_readiness_and_activity(readiness?, activity?)` | `POST /coach/log` | log | Check-in and/or an activity (`ice_hockey`, `swimming`, `swim_sauna`, `sauna`, `gym`, `cycling`, `hiking`, `running`, `other`) with server defaults for omitted fields. Atomic. |
| `upsert_daily_nutrition_plan(days, supplement_stack?)` | `PUT /coach/nutrition-plan` | log | 1-7 days of meals, ingredients, macro targets, prep steps; rebuilds each day's shopping list; optionally replaces the supplement stack. Atomic. Rejects ingredients that hit a hard exclusion in the profile (422 with the matching rule). |
| `upsert_adaptive_workout_plan(...)` | `PUT /coach/workout-plan` | log | Creates or replaces the coach session for a date: exercises with target sets, reps, kg, RIR/RPE, rest, rationale. |
| `get_exercise_baseline(exercise_name, plan_id?)` | `GET /coach/exercise-baseline` | read | Last 3-5 sessions + progression and readiness-adjusted suggestion. |

Supporting REST for the phone (not MCP): `GET/PUT /profile`,
`GET/POST /readiness-logs`, `DELETE /readiness-logs/{id}`,
`GET /meal-plans?start=&end=`, `GET /meal-plans/{date}`,
`POST|DELETE /meal-plans/meals/{meal_id}/eaten`,
`PATCH /meal-plans/ingredients/{id}` (`prepared`),
`GET /grocery-list?start=&end=`, `PATCH /grocery-list` (`ids`, `checked`),
`GET /supplements`, `GET /supplements/due?date=`,
`PUT|DELETE /supplements/{id}/intakes/{date}`.

`get_coaching_context` payload (compact keys, no nulls dropped so the shape is
stable):

```
{
  "generated_at", "window": {"start", "end", "days"},
  "profile": {"goals", "dietary_constraints", "physical_constraints", "birth_year"},
  "coaching_principles": "<admin text>",
  "equipment": [{"location", "kind", "equipment"}],
  "training": {
    "sessions": [{"date", "kind", "name", "minutes", "rpe", "load_au", "volume_kg"}],
    "totals": {"strength_sessions", "strength_volume_kg", "hockey_sessions", "swim_sessions", "load_au"},
    "exercise_trends": [{"exercise", "sessions": [{"date", "top_set"}], "e1rm_trend_kg"}],
    "upcoming": [{"date", "kind", "name"}]
  },
  "readiness": {"latest", "today_score", "load_factor", "recent": [...],
                "deficits": {"sore_muscles", "short_sleep_nights", "avg_sleep_h"}},
  "nutrition": {"plans": [day plans in window and next 2 days],
                "adherence": [{"date", "eaten", "target", "protein_pct", "energy_pct"}],
                "supplements": [{"name", "dose", "unit", "timing", "applies_on"}]}
}
```

MCP transport and auth (section 3, D4-D6): streamable HTTP `/mcp/`, SSE
`/mcp/sse`; OAuth unchanged; API tokens when `MCP_API_KEY_AUTH_ENABLED=true`.
MCP mounts when either auth mode is enabled; it never mounts without auth.

Security notes:
- An API token in an LLM vendor's connector settings is a long-lived bearer
  credential stored by that vendor. Use a dedicated token per assistant, the
  narrowest scope (`read` for analysis, `read,log` to write), revoke from
  Settings. `admin`-scoped tokens act as `read,log` on MCP; the bootstrap key
  is refused.
- Token comparison is by SHA-256 hash lookup (existing design); 401 responses
  do not say whether a token exists.
- Hard dietary exclusions are enforced server-side on every nutrition write,
  not left to the model (D11).

Actions schema `/openapi/actions.json`: OpenAPI 3.1.0, operations limited to
an allow-list (context, the three coach writes, baseline, readiness list, meal
plan read, grocery list, supplements due, logs list/create, sleep list, body
metrics list, nutrition daily summary, plans list/get, scheduled workouts
list), each with a short description (<= 300 chars), only `X-API-Key`
security, unreferenced component schemas pruned. Validated in tests with
`openapi-spec-validator`.

## 8. UI component hierarchy

```
TodayView (phone home)
├── QuickLogBar  [new, top of page, 3 x 48 px buttons]
│   ├── Swim + Sauna → POST /coach/log (optimistic row in "Done today", toast "Edit details" 5 s → /history/:logId)
│   ├── Hockey       → POST /coach/log (duration from today's load event, else 75 min)
│   └── Check-in     → ReadinessSheet (soreness slider, energy slider, sore-muscle chips, Save)
├── DoneToday        [new: today's logs and check-in score; the daily summary the bar updates]
├── CoachCard / HockeyCards / SleepCard / FoodCard  [unchanged]
└── KitchenLink      [new: "Today's meals" → /kitchen when a day plan exists]

KitchenView /kitchen  [new route, phone-first, high contrast, also in navigation]
├── DayChips (Today, Tomorrow, +2) and Tabs: Kitchen | Store
├── Kitchen tab
│   ├── SupplementReminders (due today, tap = taken)
│   └── MealCard x n: name, macros, IngredientChecklist (prepared, strike-through), PrepSteps (ordered), "Logged as eaten" / "Eaten · Undo"
└── Store tab: GroceryChecklist (aggregated across the selected days, tap = checked, strike-through, checked items sink)

WorkoutHud (live session)  [extended]
├── weight/reps dials pre-filled from suggested_* (coach target, else readiness-scaled history)
├── LastBadge "Last: 3x8 @ 70 kg"
├── CoachNoteBadge "Adjusted -10% for post-hockey recovery" / coach rationale
└── existing log button = 1-tap completion when the dials still hold the suggestion

SettingsView → CoachProfileSection [new]: goals, dietary constraints rows, physical constraints
```

Accessibility: touch targets >= 44 px, checklist rows are buttons with
`aria-pressed`, strike-through plus a check icon (state never by colour
alone), body text uses the existing `--color-text`/`--color-bg` pair (AA in
both themes); new muted text uses `--color-text-muted` only at >= 14 px.

## 9. Verification plan

- pytest: migration data preservation; readiness score/factor and strain
  derivation; context payload shape and owner scoping; nutrition upsert
  (atomicity, grocery aggregation and kept checks, exclusion rejection, eaten
  idempotency and undo); supplement due rules; adaptive workout upsert
  (idempotency, 409 after start, session start uses coach targets, readiness
  scaling of history); MCP tools registered and callable with an API token
  over real HTTP (Bearer and `X-API-Key`), bootstrap key refused, owner
  scoping, OAuth tests unchanged; Actions schema validity and size;
  `tests/test_ci_gates.py` untouched unless a workflow changes.
- vitest: readiness/energy mapping, last-session badge text, grocery
  grouping helpers.
- Playwright (desktop and 360 px mobile): meal plan PUT via API renders in
  Kitchen and Store with working checkboxes and "Logged as eaten"; Swim +
  Sauna and Hockey log in one tap and appear in Done today; a scheduled coach
  workout and a history-based one open with pre-filled, readiness-adjusted
  values and badges.
- Container: `docker compose build` / `up` where Docker is available;
  otherwise CI's image build and merge e2e (which runs the deploy Compose
  file) are the evidence, and the PR says so.
