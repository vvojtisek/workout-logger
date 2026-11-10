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

## Cycle 4 — Review completed lifts in the exercise catalogue

Opening a catalogue entry shows its best set, estimated 1RM, and recent history without
starting a workout. The catalogue and live workout share the progression card and query
logic, including the range and formula selectors. The catalogue requests completed history
for the exercise name, using the existing case-insensitive endpoint.

- The new Playwright regression called the real stats endpoint successfully and failed
  against the baseline because the catalogue had no progression panel.
- `uv run --no-sync --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 702 tests at 82% coverage. Required Ruff rules, Ruff format, and mypy passed.
  Informational Ruff stayed at the same 151 findings.
- `npm run lint`, `npm run typecheck`, `npm run test` (188 tests), `npm run build`, and
  `git diff --check` passed.
- Full localhost Playwright passed 56 tests with three existing viewport skips. After
  adding phone registration and the width assertion, the new test passed on desktop and
  at 360 px. Both runs verified zero leftover records in the nine checked SQLite tables.
- Browser verification recipe. Log a completed set, open its catalogue exercise, switch
  to Last 30 days and Brzycki, and verify the changed estimate and chart. The Playwright
  test performed those steps and verified that the app created no active workout.

## Cycle 5 — Review weekly logged sets and external volume

Training load groups workout records into Monday-start weeks in the chosen IANA timezone.
The bounded query accepts up to 26 weeks. It counts gym records with logged sets, excludes
separately recorded activities, and reuses the existing per-set weight, paired-dumbbell and
unilateral volume rules. The desktop and mobile History sections both expose the review.

- The migrated API test first failed with HTTP 404 and the baseline browser lacked the
  Training load link. The first browser RED reached the runner's timeout and lost its
  cleanup context. Both exact-tag logs were deleted through the API and verified absent.
  The revised RED uses an assertion timeout and cleaned up automatically.
- `uv run --no-sync pytest -q tests/test_training_load.py tests/test_account_data_isolation.py --tb=short --show-capture=no`
  passed five tests, including Prague DST boundaries and owner/other-account volume isolation.
- `uv run --no-sync --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 703 tests at 82% coverage. Required Ruff rules, Ruff format, mypy (149 source files),
  and `git diff --check` passed. Full Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (188 tests), and Vite build passed. The npm
  audit output still reports the four existing moderate advisories tracked in #184.
- The first full localhost run hit the invite cap in a reused test database. A repeat with
  a fresh Alembic-migrated SQLite database and a single bootstrap admin passed 59 Playwright
  tests with three existing viewport skips. All nine checked SQLite tables had zero rows
  after cleanup. The new training load table fit both desktop and 360 px phone layouts.
- Browser verification recipe. Log two sets on both sides of a Monday boundary in Prague.
  Select that week in Training load and verify that each session lands in the proper row.
  The Playwright test ran that review and verified 350 kg and two sets per session.

## Cycle 6 — Attribute external volume to primary muscle tags

The Training load view can show a primary-muscle breakdown for any week in its range.
The service reuses the catalogue resolution used by load rules, including account scope
and aliases. Each exercise's recorded external volume is split across its distinct primary
tags. Whole-tenth arithmetic keeps the breakdown reconciled to the weekly total. A remainder
tenth goes to the first tags in alphabetical order, and untagged volume is Unclassified.

- The migrated API regression first found the expected totals without any muscle breakdown.
  The baseline browser reached Training load and failed on the absent muscle table. Its
  tagged database cleanup passed.
- `uv run --no-sync pytest -q tests/test_training_load.py tests/test_volume.py tests/test_account_data_isolation.py --tb=short --show-capture=no`
  passed 16 tests. The muscle test verifies a catalogue alias, duplicate tags, secondary tags,
  unknown exercises and the split of 340.3 kg into 170.2 kg and 170.1 kg.
- Full Python coverage run passed 703 tests at 83%. Required Ruff rules, format, mypy, and
  diff checks passed. Full Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (188 tests), and Vite build passed.
- Full localhost Playwright against fresh migrated SQLite passed 59 tests with three
  existing viewport-specific skips. All nine checked tables were empty after cleanup.
- Browser verification recipe. Review a week containing a press with Chest and Triceps
  primary tags, then switch the breakdown to a week with an unclassified lift. Playwright
  verified the split, the unclassified amount, and the viewport width on desktop and phone.

## Cycle 7 — Track whole-session effort with rating coverage

Training load sums duration in minutes × session RPE in arbitrary units for rated gym workouts
and activities. Rated and logged counts and rated minutes reveal partial coverage. Weeks with
no entries and weeks with unrated entries have distinct labels. The existing history editor
can add, change, or clear a whole-session effort rating. [Session-RPE method validation](https://pubmed.ncbi.nlm.nih.gov/11708692/).

- The migrated API regression first found no session-effort metrics, two frontend tests
  failed on the missing draft field, and the baseline browser failed on the absent effort
  table. Tagged browser cleanup passed.
- Focused API and account isolation passed five tests, including 225 AU for the owner and
  a null score for the other account in the same week.
- Full Python coverage run passed 703 tests at 82%. Required Ruff rules, format, mypy,
  and `git diff --check` passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (190 tests), and Vite build passed.
- Full localhost Playwright against fresh migrated SQLite passed 59 tests with three
  existing viewport skips. All nine checked SQLite tables were empty after cleanup.
- Browser verification recipe. Review a week with a rated 40-minute activity and an unrated
  30-minute workout. Rate the workout at 6 in History, then revisit Training load. Playwright
  verified the saved rating and the change from 160 AU at 1 / 2 rated to 340 AU at 2 / 2.

## Cycle 8 — Compare a closed week's workload with its four-week baseline

The calendar workload ratio divides the selected closed local week's session-RPE load by
the mean of the four immediately preceding weeks. The API reads the baseline even if it
falls outside the visible rows. The card shows both loads and the baseline dates. It explains
missing sessions, missing ratings, an open week, or a zero baseline when a ratio is unavailable.
[Methodological analysis](https://pubmed.ncbi.nlm.nih.gov/32502973/).

- The migrated API regression first failed because the ratio field was absent. The baseline
  browser reached Training load but lacked the comparison card. Tagged cleanup passed.
- The focused API and account tests passed six tests. They include a one-visible-week request
  with a four-week lookback, an unscored log, an empty week, and an open week.
- Full Python coverage run passed 704 tests at 82%. Required Ruff rules, format, mypy, and
  `git diff --check` passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (190 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 61 tests with three existing
  viewport skips. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. Give four preceding weeks rated loads of 40, 80, 120 and
  160 AU, followed by a 180 AU week. Playwright verified the 100 AU baseline and 1.80×
  ratio, then selected an earlier week with insufficient logs and verified the explanation.

## Cycle 9 — Review repetitions at a repeated recorded weight

Past workout details can chart raw repetitions by saved set number for each repeated
external load. The table keeps the actual reps, recorded RIR, and retention relative to the
first set at that weight. Explicitly unknown loads stay out of the comparison. Older logs
with one shared weight still work. The chart labels the reference set and retains gaps in
saved set numbers when other loads intervene.

- The new frontend test first failed because the retention module was missing. The
  baseline Playwright run verified saved weights through the API, then failed on the
  missing History control. Tagged cleanup passed.
- Full Python coverage run passed 704 tests at 82%. Required Ruff rules, format, mypy,
  and `git diff --check` passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (192 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 63 tests with three existing
  viewport skips. After clarifying the saved set label, lint, TypeScript, Vite build and
  the focused desktop and 360 px phone browser tests passed. Both runs found zero rows
  in all nine cleanup tables.
- Browser verification recipe. Log 60 kg for 8 and 6 reps at saved sets 1 and 3, and
  50 kg for 10 and 12 reps at sets 2 and 4. Playwright verified the 75% and 120% values,
  the actual set indices, and the absence of a single-load comparison for a 70 kg set.

## Cycle 10 — Export the selected training weeks as session and set data

The Training load view downloads UTF-8 CSV for its selected local weeks. Session rows hold
duration and effort once per workout. Set rows join through `workout_id` and keep saved weight,
reps, and RIR, including zero and missing values. The export uses the same account-scoped
range query as Training load and a timestamp and workout ID tie-breaker. Formula-like names
are quoted and prefixed with an apostrophe. [Spreadsheet formula text handling](https://owasp.org/www-community/attacks/CSV_Injection).

- The migrated API test first received HTTP 404, and the baseline browser lacked the CSV
  control. Tagged browser cleanup passed.
- The focused export, training-load, and account-isolation run passed seven tests. It verified
  Prague boundaries, hidden baseline exclusion, exact timestamp ordering, accented and quoted
  exercise names, blanks versus zero, and owner-only rows.
- Full Python coverage run passed 705 tests at 82%. Required Ruff rules, Ruff format, mypy,
  and `git diff --check` passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm run test` (192 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 65 tests with three existing
  viewport skips. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. Choose a four-week range and download the CSV from Training
  load. Playwright read the actual bytes and verified the range filename, one included workout,
  and exclusion of an earlier workout in the ratio lookback on both desktop and phone.
