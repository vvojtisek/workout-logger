# Workout Logger improvements

## Cycle 1 — Progression uses recorded sets

Mixed-load workouts could report a heaviest set at the final working weight and estimate a lift
from that weight with reps performed on another set. The stats service now reuses the same aligned
weight and rep pairs as volume. It finds the heaviest actual set and calculates Epley per loaded
set. Desktop progression displays the actual set behind each session's highest estimate. Older
logs with a single working weight use it for every set. The endpoint retains its response fields
and compares the same working-weight values for the load trend.

Validation:

- `uv run --no-sync pytest -q tests/test_exercise_stats.py -k migrated_database` failed before the
  fix because the best load was 50 kg for a session containing a 100 kg set.
- `E2E_BASE_URL=http://127.0.0.1:18090 TEST_RUN_ID=stats-red npm run test:e2e -- exercise-stats.spec.js --project=desktop`
  failed against the baseline server with `Best 50 kg × 12 · e1RM 70 kg` in the desktop workout.
  The expected results are `Best 100 kg × 3` and `e1RM 110 kg`. The spec deleted the tagged
  session, log, and plan and verified 404 responses after deletion.
- `uv run --no-sync pytest -q tests/test_exercise_stats.py tests/test_volume.py tests/test_account_data_isolation.py --tb=short`
  passed all 24 tests, including the new regression against a migrated SQLite database.
- The required Ruff rules and format check passed for the touched Python files. Targeted mypy,
  `npm run lint -- e2e/exercise-stats.spec.js`, and `git diff --check` passed.
- Full validation passed: 700 backend tests with 82% coverage; 188 frontend tests; ESLint,
  TypeScript, Vite build, required Ruff, formatting, and mypy (146 source files).
- Full localhost Playwright suite: 55 passed, 3 existing viewport-specific skips. Database
  cleanup assertion passed with zero workout records. No route interception was used.
- Manual review recipe: log sets of 100 kg x 3 and 50 kg x 12, open a workout for that exercise,
  and verify Best 100 kg x 3 / e1RM 110 kg and the matching chart point. This path was verified
  by Playwright rather than a separate human/manual pass.
- Baseline issues are tracked separately: #183 (intermittent catalogue search input reset),
  #184 (moderate ESLint dependency advisories). Full Ruff is informational; its existing
  violations remain outside this feature scope. Helm/Kubernetes gates do not apply: those
  artifacts were removed from the current repository. Production Compose/security CI will
  run when the milestone PR is opened.
- Added `uv.lock` to reproduce the Python dependencies used by these checks. Local checks
  used Python 3.11, matching CI. No production data, schema, or API fields changed.

## Cycle 2 — Select the one-rep-max equation

Desktop progression offers Epley, Brzycki, Lombardi, and Wathen. The server calculates the
selected estimate from the same recorded weight and rep pairs used for heaviest-set statistics.
React Query keeps separate results for each formula. The default Epley calculation still uses
all recorded rep counts. The other formulas use an app limit of 1–10 reps and omit estimates
for sessions with no eligible loaded set. The chart shows the equation and its input assumptions.
[Reference for the equations, Table 1](https://doi.org/10.1007/s11332-024-01264-y).

- `uv run --no-sync pytest -q tests/test_exercise_stats.py -k selected_formula --tb=short --show-capture=no`
  failed before implementation because Brzycki returned the default Epley result of 205 kg
  instead of 124 kg.
- `E2E_BASE_URL=http://127.0.0.1:18090 TEST_RUN_ID=stats-model-red npm run test:e2e -- exercise-stats.spec.js --project=desktop`
  reached the baseline chart and failed because the formula selector was absent. Tagged cleanup
  verified 404s after deleting the session, log, and plan.
- `uv run --no-sync pytest -q tests/test_exercise_stats.py tests/test_volume.py --tb=short`
  passed all 21 tests, including the migrated SQLite regression for all formulas, rep bounds,
  and invalid input.
- `npm run typecheck`, `npm run lint`, targeted Ruff check and format, targeted mypy, and
  `git diff --check` passed.
- Full validation passed: 701 backend tests, 188 frontend tests, ESLint, TypeScript, Vite build,
  required Ruff, formatting and mypy. Full Ruff remains at the unchanged 151 baseline findings.
- Localhost browser suite: 55 passed, 3 existing viewport-specific skips; all workout cleanup
  counts are zero. The new real-browser regression switches all four models and verifies the
  displayed results. Manual review follows that same selector path; no separate manual pass.
- Commands: `uv run --python 3.11 --with pytest-cov pytest --cov=app --cov-report=term-missing`,
  `uv run --python 3.11 ruff check --select E4,E7,E9,F .`, `ruff format --check .`, `mypy app/`,
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`,
  and `scripts/assert_empty_e2e_database.py` on the temporary database.
- Production Compose and security CI remain pending the milestone PR. No schema changes.
## Cycle 3 — Compare progression within a history range

Desktop progression can isolate the last 30, 90, or 365 days. The filter applies to the
headline stats and the recent chart so both answer the same question. The exercise stats
query validates paired timezone-aware endpoints and applies the inclusive start and exclusive
end in SQL before calculating any stats. Requests without a range retain all history.

- Before the fix, the migrated API regression counted four sessions in a two-session range.
  The browser reached the existing chart and failed because its history selector was absent.
- `uv run --no-sync pytest -q tests/test_exercise_stats.py --tb=short --show-capture=no`
  passed 11 tests, including a non-UTC timestamp range and invalid range cases.
- `uv run --no-sync --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 702 tests at 82% coverage. The coverage plugin ran through `uv --with` because the
  workspace environment does not include it by default.
- `npm run lint`, `npm run typecheck`, `npm run test` (188 tests), `npm run build`, required
  Ruff rules, Ruff format, mypy (146 source files), and `git diff --check` passed. Informational
  full Ruff remained at the 151 baseline findings.
- The full Playwright suite against the migrated localhost application passed 55 tests with
  three existing viewport-specific skips. The database cleanup assertion found zero records
  in all nine checked tables.
- Browser verification recipe. Log a heavier set 120 days ago and a lighter workout today.
  Open the desktop workout and switch from All history to Last 30 days, then compare the
  heaviest set and estimate, switch formulas, and restore All history. Playwright ran this flow.
