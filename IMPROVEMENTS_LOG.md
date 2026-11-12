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

## Cycle 11 — Record RPE and RIR independently in the phone HUD

Strength sets offer inline RIR and RPE controls. The RPE scale accepts every integer from
0 through 10. Ratings start blank on each new set, and the completion button still records
the prefilled set in one tap. Cached drafts can include RPE and older drafts still load.
A correction that omits RPE preserves the stored rating. A phone correction can clear it
by sending null.

- The migrated API regression initially returned null after a correction omitted the saved
  RPE of 9. The phone browser regression reached the HUD and failed on the missing RPE control.
- The first full browser run showed that an immediate reload can interrupt an in-flight
  IndexedDB draft write. The final test waits for the actual committed draft, then reloads
  and checks it in the HUD. The targeted run and full rerun passed.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 705 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm test` (192 tests), and Vite build passed.
- Full localhost Playwright on a fresh migrated SQLite database passed 66 tests with three
  existing viewport skips. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. On a phone, select RIR 2 and RPE 0, reload after the draft
  is stored, and complete the set. Playwright verified both ratings and the rest timer,
  then cleared RPE in the HUD and verified that RIR remained 2 through the real API.

## Cycle 12 — Preserve and export completed per-set RPE

Completed strength sets carry their individual RPE into History and the Training load CSV.
History keeps ratings attached to the set when an athlete adds, edits, or removes rows. The
CSV adds `set_rpe` after the existing columns, preserving zero and leaving missing values
blank. Whole-workout `effort_rpe` remains a separate field.

The additive migration copies ratings from a linked completed session only when ownership,
exercise identity and order, and the recorded set values match. Older replacement clients
keep stored RPE when the ordered exercise and set values match. For a changed layout, clients
can send aligned `rpe_per_set` values. Explicit null clears the field.

- The migrated API and upgrade regressions first failed on the missing field and column.
  The phone browser reached History but could not find the set ratings. Separate API tests
  reproduced RPE loss on a legacy replacement and the missing CSV column before both fixes.
- Focused regressions passed for migrated completion, backfill, downgrade and re-upgrade,
  legacy PUT and PATCH, and CSV zero and blank values. The history test preserved ratings
  during an unrelated edit, left a new set unrated, and removed the rating with its set.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 706 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. The new migration passed all Ruff rules. Full Ruff stayed at 151 baseline findings.
- `npm ci`, ESLint, TypeScript, `npm test` (192 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 66 tests with three existing
  viewport skips. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. Open a completed workout with RPE 0 and 9, add a set,
  and remove the first set. Playwright verified the displayed and stored order, then
  separately verified the exported set rating in the downloaded CSV on desktop and phone.

## Cycle 13 — Commit offline set queue changes atomically

Set enqueues and removals now read and update the IndexedDB queue in one transaction. The UI
acknowledges queued actions after the transaction commits. Synchronization drains in order and
checks again if another set was logged during a replay. Local write failures leave the set
available to retry and surface an error. An unreadable queue stays available for recovery.

- The baseline browser ran two set actions in one task while offline. Only one operation
  remained in IndexedDB. The updated test saw both operations after their commits, then
  verified each operation ID and value through the real server after reconnection.
- The browser also verified that a standalone skip leaves rest inactive. A frontend test
  verified that an unreadable queue is preserved when a new action is attempted.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 706 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm test` (193 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 66 tests with three existing
  viewport skips. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. Disconnect while a workout is active, complete one set
  and skip another in quick succession, then reconnect. Playwright verified the two
  distinct operations, one server entry per set, and an empty local queue after replay.

## Cycle 14 — Advance the phone workout and run rest offline

The phone HUD advances after IndexedDB commits a set. It prefills the next set from the
local entry, distinguishes pending entries, and locks server corrections until replay.
The athlete can navigate the sets and adjust or skip the pending set's rest without a
network request. Finishing waits for queued sets to synchronize.

The set API accepts a capture timestamp and an optional adjusted rest duration for queued
completions. It bounds the timestamp by workout start and server receipt. Replay keeps the
original rest deadline, and a late replay preserves the timer from a newer completed set.
Requests without capture metadata retain server-time logging.

- The original phone HUD stayed on set 1 after the offline completion. API regressions
  reproduced discarded capture time and a late replay overwriting a newer rest deadline.
- The two focused migrated API tests passed for original timestamps, offline skip, future
  clock bounds, and a newer timer preserved after a late replay. Focused phone tests passed.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 708 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm test` (193 tests), and Vite build passed.
- Full localhost Playwright on fresh migrated SQLite passed 67 tests with four
  viewport skips, including the new phone-only scenario. The cleanup check found zero rows
  in all nine checked tables.
- Browser verification recipe. Disconnect, complete a set, add 15 seconds, skip rest, and
  complete the next set. Playwright verified local focus and timer controls, the finish
  guard, zero server focus or rest requests while offline, and both original operation IDs
  and the last capture deadline after reconnection.

## Cycle 15 — Recover an owned workout after an offline reload

The service worker can load the public workout shell and its required assets offline. The
browser restores the last verified account's active workout from IndexedDB and reapplies its
committed queue. Offline authorization exposes only the workout route. It cannot send queued
actions until the server verifies the current cookie and the active session's owner. A server
denial removes the local account pointer. Sign-out clears the resume snapshot. A stale session
response cannot replace a workout opened or updated while that request was in flight.

- The baseline phone browser could queue a set but could not hard-reload `/workout` offline.
  The migrated account-isolation regression initially lacked the session's owner identifier.
- The final browser test resumed a pending set and its timer after hard reload. It verified
  there were no personalized API responses in Cache Storage, then reconnected and recorded
  exactly one replay. Removing the session cookie before a second reconnect produced zero
  additional POSTs, left the pending set in IndexedDB, and hid the old workout on offline reload.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 708 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm test` (193 tests), and Vite build passed. Making the workout
  route part of the shell increased the gzipped entry bundle from 106.00 to 122.27 kB.
- Full localhost Playwright on fresh migrated SQLite passed 68 tests with five viewport
  skips, including the new phone-only scenario. The cleanup check found zero rows in all nine
  checked tables. The full browser suite also passed after the stale-response guard was added.
- Browser verification recipe. Load a workout online, disconnect, log one set, and reload.
  Reconnect to synchronize it. The browser test separately removed the active cookie before
  reconnection and verified that the queued set remained local after the server rejected the session.

## Cycle 16 — Calculate symmetric barbell loads from plate stock

On a strength exercise tagged for a barbell, the phone HUD can show the plate stack for the
entered total load. The bounded solver uses integer grams, accounts for the bar and collars,
respects available plate pairs, prefers fewer plates for an exact load, and reports the nearest
supported loads when the requested total is unavailable. Its built-in inventory is labeled as
the default. The calculator never changes the set's recorded weight. Session responses now carry
the exercise's equipment tags so the HUD can hide the calculator on incompatible lifts.

- Unit regressions cover a non-greedy exact stack, minimum plate count, nearest supported loads,
  fractional collars, bare-bar cases, inventory limits, and invalid precision. The localhost
  browser flow confirmed the default profile, live recalculation, nearest choices, saved weight,
  and absence on a machine lift.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 708 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational Ruff stayed at the existing 151 findings.
- `npm ci`, ESLint, TypeScript, `npm test` (197 tests), and Vite build passed. The gzipped entry
  bundle is 123.41 kB.
- Full localhost Playwright on fresh migrated SQLite passed 69 tests with six viewport skips.
  The existing offline reconnect test initially exposed a transient network-ready race; after
  a transport-only retry was added to auth refresh, the focused test passed six consecutive
  runs and the full suite passed. The cleanup check found zero rows in all nine checked tables.
- Browser verification recipe. On a barbell set, open **Barbell plates**, raise the load by
  2.5 kg and inspect each side. Enter 63 kg to view the closest loads, then save the set and
  confirm that 63 kg is recorded unchanged. Start a machine set and confirm that no calculator
  is shown.

## Cycle 17 — Configure named barbell profiles per location

Gym equipment differs by bar, collars, and available plates. Locations now store up to eight
named profiles, each with its bar mass, collar mass, and bounded paired plate stock. Profile
weights are limited to gram precision and plate sizes are unique. A location editor supports
adding and removing profiles and plate sizes. Starting a workout includes that location's
profiles in its session response, so the phone can switch bars while calculating a load. The
profile only informs the calculation; it never changes the weight submitted with a set. The
existing location-check response remains unchanged.

- An additive migration gives existing locations an empty profile list. API coverage verifies
  create, read, replacement, normalized plate ordering, precision and stock limits, duplicate
  profile rejection, and session profile delivery. Account isolation verifies that another
  account cannot read the configured location.
- The mobile browser configured a 25 kg safety bar and a 15 kg technique bar in a real location,
  selected each in the active workout, verified symmetric per-side stacks, switched to the
  default inventory, and confirmed the session retained both saved profiles.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 711 tests at 82% coverage. The required Ruff gate, changed-file format check, full Ruff
  on the new migration, mypy, and `git diff --check` passed. Informational full Ruff remains at
  the repository's existing 151 findings.
- `npm test` passed 198 tests; ESLint, TypeScript, and Vite build passed. Full localhost
  Playwright on fresh migrated SQLite passed 70 tests with seven viewport skips. Cleanup found
  zero rows in all nine checked tables.
- Browser verification recipe. In Locations, add a safety squat bar and a technique bar with
  their actual weights and paired plates. Start a barbell workout at that location, open
  **Barbell plates**, compare the same set under each profile, then select **Default inventory**.
  Save a set and confirm its recorded load did not change when switching profiles.

## Cycle 18 — Calculate adjustable dumbbell loads per hand

The weight field records the load of one dumbbell. Locations can now store up to eight named
adjustable-dumbbell profiles with handle and collar mass and symmetric plate-pair stock. The
same bounded integer-gram solver computes the stack on each side of one dumbbell, while the HUD
labels the resulting load per dumbbell. The location editor validates and persists inventories,
and the active session response carries them into the workout and its offline snapshot. Choosing
a different profile never changes the saved set weight.

- API regressions cover profile round-trip, gram precision, and delivery to started and active
  sessions. Account-isolation coverage includes the new inventory field. Existing location-check
  responses retain their original shape.
- The mobile browser configured an adjustable pair at a training location, logged a barbell set,
  moved to a dumbbell exercise, and verified a 10 kg per-dumbbell load uses one 4 kg plate on
  each side of a 2 kg handle.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 712 tests at 82% coverage. Required Ruff checks, format, full Ruff on the new migration,
  mypy, and `git diff --check` passed. Informational full Ruff remains at 151 repository findings.
- `npm test` passed 198 tests; ESLint, TypeScript, and Vite build passed. Full localhost
  Playwright on fresh migrated SQLite passed 70 tests with seven viewport skips. Cleanup found
  zero rows in all nine checked tables.
- Browser verification recipe. In Locations, add an adjustable-dumbbell profile with its handle
  mass and plate stock. Start a workout at that location, advance to a dumbbell exercise, open
  **Dumbbell plates**, and compare the calculated per-hand stack with the entered load. Save a
  set and verify the set weight is unchanged.

## Cycle 19 — Alert once when a rest timer expires

The active workout now plays one short tone and requests a brief vibration when a rest deadline
expires. Sound and vibration have independent, device-local controls in Settings and default on.
Sound is prepared by the athlete's completed-set action to meet browser audio gesture rules.
The absolute rest deadline is claimed in persistent and in-memory guards so parallel timer views,
remounts, and reloads do not repeat a cue. The visible timer remains the completion signal when a
browser lacks audio or vibration support.

- Unit coverage verifies device preference persistence, independent choices, one claim per
  deadline, and graceful behavior when local storage is blocked.
- A real localhost workout with a two-second rest verified exactly one audio oscillator and one
  vibration pattern in both desktop and phone browser projects. The Settings flow switched both
  preferences off and verified they stayed off after reload.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 712 tests at 82% coverage. The required Ruff gate, `git diff --check`, and mypy passed.
  Informational full Ruff remains at 151 repository findings.
- `npm test` passed 201 tests; ESLint, TypeScript, and Vite build passed. Full localhost
  Playwright on fresh migrated SQLite passed 74 tests with seven viewport skips. Cleanup found
  zero rows in all nine checked tables.
- Browser verification recipe. In Settings, leave both rest cues on and reload. Start a workout,
  complete a set with a two-second rest, and wait past its deadline. Confirm one tone and one
  vibration. Repeat with each cue disabled to verify independent preferences.

## Cycle 20 — Classify and filter exercises by movement pattern

Exercise catalogue entries can now carry up to four validated movement-pattern tags: horizontal
and vertical pushes and pulls, squat, hinge, lunge, carry, rotation and anti-rotation, trunk
flexion and extension, and locomotion. Classifications complement muscle and equipment tags and
do not claim a joint-stress score. Existing entries migrate as unclassified until someone edits
them. The catalogue editor and detail/list views expose the tags, and both the API and catalogue
filter can select exercises by one movement pattern before pagination and location matching.

- API tests verify round-trip and replacement, reject unknown or duplicate tags and unknown
  filters, and confirm multi-tag matches are filtered before pagination. The migration test
  preserves a pre-existing exercise with an empty classification and verifies downgrade removes
  only the added column. Test-first runs showed five API failures and one frontend URL-builder
  failure before the implementation.
- A real localhost, migrated-SQLite Playwright journey created, read, edited, searched, filtered,
  and deleted a tagged exercise on desktop and phone layouts. E2E cleanup confirmed zero rows in
  all nine tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 717 tests at 82% coverage. The required Ruff gate, format check, mypy, and
  `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- ESLint, TypeScript, and Vite build passed; `npm test` passed all 202 tests. Full localhost
  Playwright passed 75 tests with seven expected viewport skips.
- Browser verification recipe. In Exercise Catalogue, create or edit an exercise and select one
  or more movement patterns. Confirm the tags on its detail and list cards. Filter by one pattern
  and check that matching multi-tag exercises remain; clear the filter to restore the catalogue.

## Cycle 21 — Configure the progression increment per exercise

The exercise catalogue can override the double-progression load increase with a user-set value
from 0.05 to 20 kg in 0.01 kg steps. The next-session engine uses the override when every set
reaches the top of its rep range with reserve. An unset value preserves the existing
equipment-based 1 kg or 2.5 kg rule. An additive migration after the exercise volume-rule
revision adds the nullable field, so legacy exercises keep automatic progression.

- API tests verify create, replacement, clearing, range and precision validation. A migrated
  database test confirms a pre-existing exercise remains automatic and verifies downgrade. The
  next-session regression logs a completed dumbbell row at 22 kg and verifies the configured
  increment suggests 22.25 kg. Four API assertions failed against the baseline before
  implementation because the field was ignored or absent.
- The exercise editor persists the override on desktop and phone. A real migrated-SQLite browser
  flow then creates a plan, records three top-of-range sets, starts the next session through the
  real API, and verifies the 20.25 kg suggestion. E2E cleanup found zero rows in all nine
  tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 709 tests at 82% coverage. Required Ruff rules, format, mypy, and `git diff --check`
  passed. Informational full Ruff remains at the existing 151 findings.
- ESLint, TypeScript, Vite build, and all 197 Vitest tests passed. Full localhost Playwright
  passed 67 tests with three expected viewport skips.
- Browser verification recipe. Edit an exercise and set **Progression increment (kg)** to
  0.25. Record all sets at the top of the plan's rep range, then start the plan again. Confirm
  the suggested load is previous load + 0.25 kg. Clear the override to restore the automatic
  equipment-based step.

## Cycle 22 — Review each program's scheduled workout states

The Programs page now reports scheduled, in-progress, completed, and skipped workout counts
for each program. `GET /api/v1/programs/schedule-summary` returns the same account-scoped
counts and keeps the four states distinct instead of combining them into an inferred score.

- The API tests create one workout in each state and verify the exact per-program counts. An
  account-isolation assertion confirms another invited account cannot see a private program's
  summary. Both new endpoint checks failed against the baseline before the route existed.
- The real migrated-SQLite browser flow schedules a workout, starts it, and verifies the
  Programs counts on desktop and phone. The phone test minimizes the active workout HUD to
  reach the navigation tabs. Both focused viewport runs passed, and cleanup found zero rows
  in all nine tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 710 tests at 82% coverage. Required Ruff rules, Ruff format, mypy, and
  `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- ESLint, TypeScript, Vite build, and all 197 Vitest tests passed. Full localhost Playwright
  passed 68 tests with three expected viewport skips; cleanup again found zero rows in all
  nine tracked tables.
- Browser verification recipe. Schedule four workouts in one program. Mark one skipped,
  start and complete one, start another, and leave the fourth scheduled. Confirm the Programs
  row reports one in each state, then cancel the active workout and verify its count returns
  to Scheduled.

## Cycle 23 — Include recorded RIR in estimated one-rep max

Exercise progression estimates now use effective reps: logged repetitions plus logged RIR.
Unknown RIR leaves the original rep count unchanged, and actual repetitions remain the value
shown in workout history. The progression card explains that 4+ is represented by four, which
makes estimates based on that value a lower-bound input. Brzycki, Lombardi, and Wathen apply
their existing 1–10 range to effective reps.

- The new API regression first failed on the baseline: 60 kg for five reps at three RIR was
  reported as 70 kg instead of the expected RIR-adjusted 76 kg. It also checks the adjusted
  Brzycki result and confirms the chart point retains the actual five reps.
- The real migrated-SQLite exercise progression flow passed on desktop and phone, checking the
  RIR-adjusted Epley and Brzycki estimates. Cleanup found zero rows in all nine tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 711 tests at 82% coverage. Required Ruff rules, Ruff format, mypy, and
  `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- ESLint, TypeScript, Vite build, and all 197 Vitest tests passed. Full localhost Playwright
  passed 68 tests with three expected viewport skips; cleanup again found zero rows in all
  nine tracked tables.
- Browser verification recipe. Log a 60 kg set for five reps at three RIR, then open the
  exercise's progression card. Confirm it displays five actual reps while Epley estimates from
  eight effective reps (76 kg), and Brzycki uses the same effective-rep count (74.5 kg).

## Cycle 24 — Prescribe a target RIR per planned exercise

Plan authors can optionally set a target RIR from 0 to 10 for each strength exercise. Starting
a workout copies that prescription into the session snapshot, so later plan edits do not change
an active session. The desktop workout and in-gym HUD show the target beside the control for
recording actual set RIR; plans without a target keep the existing uncluttered display.

- API tests first failed because create/update omitted the field, accepted an out-of-range
  value, and session snapshots did not carry it. The frontend schema test also confirmed the
  field was discarded and did not reject values above 10.
- An additive migration adds nullable constrained fields to plan and session exercises, keeping
  existing records unset. The real browser flow creates and edits a target through the desktop
  plan builder, verifies it in the session snapshot, and confirms it on the desktop workout.
  The phone HUD flow checks the same target beside the RIR pills. Both focused runs cleaned all
  nine tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 714 tests at 82% coverage. Required Ruff rules, Ruff format, mypy, the single Alembic
  head check, and `git diff --check` passed. Informational full Ruff remains at the existing
  151 findings.
- ESLint, TypeScript, Vite build, and all 199 Vitest tests passed. Full localhost Playwright
  passed 68 tests with three expected viewport skips; cleanup found zero rows in all nine
  tracked tables.
- Browser verification recipe. Set Target RIR to 2 on one plan exercise and leave another
  blank. Start the plan, confirm only the prescribed exercise shows Target RIR: 2 in the
  desktop and phone workout views, then edit the plan and verify the active snapshot is
  unchanged.

## Cycle 25 — Preserve target RIR when duplicating a plan

Duplicating a workout plan now copies each exercise's optional target RIR along with its other
prescription fields. This keeps the copied plan equivalent to the original before the user
chooses to make changes.

- The real browser regression first failed on the baseline because the duplicate endpoint
  response omitted the original exercise's target RIR. After the fix it verifies the duplicated
  plan through the actual GUI action and API response.
- The focused migrated-SQLite browser run passed and verified cleanup across all nine tracked
  tables. The full localhost Playwright suite also passed.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 714 tests at 82% coverage. Required Ruff rules, mypy, and `git diff --check` passed.
  Informational full Ruff remains at the existing 151 findings.
- ESLint, TypeScript, Vite build, and all 199 Vitest tests passed. Full Playwright passed 69
  tests with three expected viewport skips; cleanup found zero rows in all nine tracked tables.
- Browser verification recipe. Create a strength plan with Target RIR 2, choose Duplicate,
  then inspect the copy through the API and confirm the exercise still carries Target RIR 2.

## Cycle 26 — Calculate barbell plate loading from configured gym equipment

The mobile strength-workout HUD now calculates a symmetric per-side plate setup from the
current weight dial. Settings store the bar weight and available plate pairs. The bounded
combination search minimizes the number of plates, respects pair counts, and reports the closest
achievable total when the exact request cannot be loaded. Showing the bar contribution and
excluding collars makes the arithmetic explicit instead of asking the lifter to do it between
sets.

- The settings API now validates quarter-kilogram plate sizes, pair counts, unique sizes, and
  bar weight. An additive migration supplies a standard starting profile while preserving
  existing rest preferences. The Settings screen can adjust the bar and available pairs.
- API regressions first confirmed the new fields were ignored and invalid pair counts accepted.
  Plate math tests cover minimum-count combinations, limited inventory, unavailable targets,
  below-bar requests, and selecting the closest load on either side.
- The migrated-SQLite mobile browser flow configures the profile through Settings, starts a real
  plan, and verifies the per-side setup at two loads. Cleanup found zero rows in all nine tracked
  tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 717 tests at 82% coverage. Required Ruff rules, Ruff format, mypy, Alembic metadata
  parity, and `git diff --check` passed. Informational full Ruff remains at the existing 151
  findings.
- ESLint, TypeScript, Vite build, and all 204 Vitest tests passed. Full localhost Playwright
  passed 70 tests with four expected viewport skips; cleanup again found zero rows in all nine
  tracked tables.
- Browser verification recipe. In **Settings → Preferences**, set the bar weight and available
  pairs. Start a strength workout, open **Plate calculator**, and check that each side matches
  the loaded weight; change the weight dial and confirm the distribution updates. Unavailable
  loads show the closest achievable total.

## Cycle 27 — Plot RIR-adjusted performance across repeated loads

Past-workout rep-retention charts can now switch from recorded reps to estimated reps at failure
for sets at the same load. The estimate is recorded reps + recorded RIR; sets without an RIR stay
missing from that curve. The table keeps actual reps, RIR, the estimate, and both retention
percentages separate, so a change in reported reserve is visible alongside rep dropoff without
presenting the estimate as a directly measured failure threshold.

- The unit regression first failed because the baseline had no estimated-at-failure values. It
  now verifies the first rated set as its own baseline and preserves unknown RIR as missing.
- The migrated-SQLite browser flow records alternating loads and mixed RIR, then checks the
  estimate and retention values on desktop and phone. It verifies the chart selector and confirms
  the document does not overflow the phone viewport. Cleanup found zero rows in all nine tracked
  tables.
- Full Python coverage passed 717 tests at 82%. ESLint, TypeScript, all 204 Vitest tests, Vite
  build, required Ruff rules, Ruff format, mypy, and `git diff --check` passed. Informational full
  Ruff remains at the existing 151 findings.
- Full localhost Playwright passed 70 tests with four expected viewport skips; cleanup found
  zero rows in all nine tracked tables.
- Browser verification recipe. Log multiple sets at the same weight with RIR on at least two.
  In the past workout, expand **Rep retention at the same weight** and switch its chart measure
  to **Estimated reps at failure**. Compare the estimated values with actual reps and RIR in the
  adjacent table; unrated sets should not appear in the curve.

## Cycle 28 — Classify catalogue exercises by movement pattern

The exercise catalogue now supports an optional controlled movement pattern: horizontal or
vertical push/pull, squat, hinge, lunge, carry, rotation, core stability, or locomotion. The
catalogue can filter by a selected pattern, and the builder and detail view display the
classification. Existing entries stay unclassified until someone reviews them; movement patterns
complement the existing muscle tags.

- API regressions cover valid and invalid patterns, nullable classification, and list filtering.
  Browser-schema regressions cover the controlled values and nullable form payload.
- The migrated-SQLite browser flow creates a tagged exercise in the GUI, reads the classification
  from the real API, checks the detail label, filters the catalogue, edits the exercise, and
  deletes it. The focused run and full desktop/mobile browser suite both verified zero rows in
  all nine tracked tables after cleanup.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 719 backend tests at 82% coverage. ESLint, TypeScript, all 208 Vitest tests, and the Vite
  production build passed. Required Ruff rules, Ruff format, mypy, the single Alembic head check,
  and `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- Full localhost Playwright passed 70 tests with four viewport-specific skips; cleanup found zero
  rows in every tracked table.
- Browser verification recipe. In **Exercises**, add an exercise with a movement pattern, view
  its detail classification, filter the catalogue to that pattern, then edit and clear it. Older
  exercises remain available under **Any pattern** until explicitly classified.

## Cycle 29 — Switch equipment profiles during a workout

The plate calculator now supports named equipment profiles, so a lifter can account for different
bar baselines and plate inventories in one gym. Settings can add, rename, remove, edit, and choose
the default profile; the mobile workout calculator can switch profiles without interrupting a set.
The selected profile's bar weight and inventory drive the load calculation.

- The additive migration copies each existing bar weight and inventory into a default profile,
  preserving configured equipment. Legacy settings fields remain mirrored to the selected
  profile for existing clients.
- API regressions verify profile round trips, active-profile selection, validation of duplicate
  IDs and unknown selections, and migration of a customized 15 kg bar/inventory. The migrated
  mobile browser journey edits the default inventory, adds a 15 kg technique bar, and switches
  the active workout calculator to it. Cleanup found zero rows in all nine tracked tables.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed 722 backend tests at 82% coverage. ESLint, TypeScript, all 208 Vitest tests, and the Vite
  production build passed. Required Ruff rules, Ruff format, mypy, the single Alembic head check,
  and `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- Full localhost Playwright passed 70 tests with four viewport-specific skips; cleanup found zero
  rows in every tracked table.
- Browser verification recipe. In **Settings → Preferences**, add a profile with a different
  bar weight and inventory. Start a strength workout, open **Plate calculator**, select that
  profile, and confirm both the displayed bar contribution and the per-side plate load update.

## Cycle 30 — Review planned set exposure by movement pattern

The plan editor now shows a live summary of target sets by movement pattern. It matches planned
exercise names and aliases to the reviewed catalogue taxonomy and reports untagged, ambiguous, or
free-text rows as unclassified. Counts describe the prescription; they do not grade it against a
universal balance target.

- A pure summary helper regression covers exact names, aliases, case-insensitive matching,
  ambiguous aliases, unclassified catalogue entries, and invalid or blank draft rows. The
  migrated-SQLite browser journey verifies a tagged squat and an unmatched lunge appear in their
  respective groups while building a real superset plan; generated exercises and plans are
  removed, and all nine tracked tables are empty after cleanup.
- Backend coverage passed 722 tests at 82%. ESLint, TypeScript, all 211 Vitest tests, and the Vite
  production build passed. Required Ruff rules, Ruff format, mypy, the single Alembic head check,
  and `git diff --check` passed. Informational full Ruff remains at the existing 151 findings.
- Full localhost Playwright passed 70 tests with four viewport-specific skips; cleanup found zero
  rows in every tracked table.
- Browser verification recipe. Create or edit a plan using a catalogue exercise with a reviewed
  movement pattern alongside a free-text or unclassified exercise. Watch **Planned sets by
  movement pattern** update as target set counts change; the unclassified bucket should remain
  separate.

## Cycle 31 — Visualize same-load rep retention within a session

Exercise progression now summarizes repeated loads from the latest session as set-to-set rep
curves. The API groups sets at the same recorded load, preserves their workout order, and reports
last-set reps as a percentage of the first set. The progression card shows the sequence and an
accessible sparkline even when the selected 1RM formula cannot chart that session. Sets at
different loads remain separate, and the label describes a rep drop-off measure rather than bar
velocity or a failure estimate.

- API tests cover repeated-load grouping, per-set order, percentage calculation, and omission of
  loads that appear only once. Existing log records and write endpoints are unchanged.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed all 720 tests at 82% coverage. The required Ruff gate, format check, mypy, and
  `git diff --check` passed; informational full Ruff remains at the 151 existing findings.
- `npm test` passed all 202 tests; ESLint, TypeScript, and Vite build passed. Full localhost
  Playwright on fresh migrated SQLite passed 75 tests with seven expected viewport skips. Cleanup
  found zero rows in all nine tracked tables.
- Browser verification recipe. Open a catalogued exercise with a recent logged session that has
  two sets at the same weight and another set at a different weight. Confirm the same-load curve
  includes only the repeated weight, follows set order, and reports final-to-first rep retention.

## Cycle 32 — Compare one-rep-max equation sensitivity

Exercise progression now reports the estimate range produced by Epley, Brzycki, Lombardi, and
Wathen on one shared reference set: the latest session's heaviest set in the common 1–10 rep
range. The API also returns each rounded equation estimate and the range as a percentage of their
mean. The UI keeps the four values expandable beneath the compact spread summary. This exposes
equation sensitivity without describing it as statistical model fit; sessions without a common
reference set show no spread.

- API tests verify all four results, the spread calculation, and the empty state outside the
  shared rep range. The browser journey checks the response and all four visible equation labels.
- `uv run --python 3.11 --extra dev --with pytest-cov pytest --cov=app --cov-report=term-missing`
  passed all 722 tests at 82% coverage. Required Ruff, format, mypy, frontend tests, ESLint,
  TypeScript, Vite build, and `git diff --check` passed. Full localhost Playwright on fresh
  migrated SQLite passed 75 tests with seven expected viewport skips; all nine cleanup tables
  were empty.
- Browser verification recipe. Open an exercise with a recent 1–10 rep loaded set. Read the
  same-set equation spread, expand **View all four estimates**, and compare each value. Record a
  session containing only sets above ten reps to confirm the spread is omitted.

## Cycle 33 — Show program microcycle week and block progress

The Programs list now translates each date-bounded program into seven-day weeks measured from
its start date. It shows the current week, total weeks, and elapsed percentage with an accessible
progress bar. Future blocks show days until start, ended blocks retain their final week, and
open-ended programs show their current week without inventing a duration. Date-only arithmetic
keeps week boundaries stable across daylight-saving changes and time zones.

- Unit tests cover active, future, ended, and open-ended blocks. The browser journey creates a
  four-week program and checks the first-week label and elapsed progress; it now runs on desktop
  and phone viewports.
- Backend validation passed all 722 tests at 82% coverage. All 206 frontend tests passed; ESLint,
  TypeScript, Vite build, required Ruff, format, mypy, and `git diff --check` passed. Full localhost
  Playwright on fresh migrated SQLite passed 76 tests with seven expected viewport skips; cleanup
  found zero rows in all nine tracked tables.
- Browser verification recipe. Create a program with start and end dates 28 days apart. Confirm
  it shows Week 1 of 4 and 4% elapsed, then edit the dates to verify the current week updates.

## Cycle 34 — Track scheduled workout states by microcycle

Program schedule summaries now include weekly counts for scheduled, in-progress, completed, and
skipped workouts. Seven-day buckets are anchored to each program's start date; weekly buckets
include only workouts scheduled inside the program's date range, while existing overall counts
continue to include every workout linked to the program. The Programs list shows the current
microcycle's counts beside its week and elapsed-block progress, without combining the states into
an inferred completion score.

- The API regression covers sessions across two weeks and confirms out-of-range sessions remain
  in overall totals without being assigned to an in-block week. The real migrated-SQLite browser
  flow verifies week counts for scheduled and in-progress workouts, and that cancelling an active
  workout returns it to Scheduled on desktop and phone.
- `uv run pytest -q` passed all 739 backend tests. `npm test` passed all 225 frontend tests;
  ESLint, TypeScript, Vite build, required Ruff, Ruff format, mypy, and `git diff --check` passed.
  Full localhost Playwright passed 78 tests with eight expected viewport skips. E2E cleanup
  verified zero application rows in its tracked tables and zero tagged body-metric, sleep, step,
  and meal rows.
- Browser verification recipe. Create a program that starts today, schedule a workout today, and
  open Programs. Confirm its active week shows one Scheduled workout. Start it and check the
  count moves to In progress; cancel the workout and confirm it returns to Scheduled. A skipped
  workout should remain distinct from both scheduled and completed sessions.

## Cycle 35 — Inspect schedule states across the full block

Programs now expose a collapsed week-by-week table with scheduled, in-progress, completed, and
skipped counts for every microcycle that contains a scheduled workout. The table uses the existing
date-bounded API summary, keeps status categories separate, and leaves the current-week summary
visible for a quick scan. This makes planned distribution and gaps across the block inspectable
without crowding the program list or implying that unlike states combine into a completion score.

- The real-API browser journey creates a second-week workout, expands the accessible table, checks
  Week 1 and Week 2 counts, then deletes the added record and verifies its absence on desktop and
  phone. E2E audit rows bearing this cycle's unique run IDs were also removed from the temporary
  SQLite database and checked for absence.
- `uv run pytest -q` passed all 739 backend tests; `npm test` passed all 225 frontend tests.
  ESLint, TypeScript, Vite build, required Ruff, Ruff format, mypy, and `git diff --check` passed.
  Full localhost Playwright passed 78 tests with eight expected viewport skips.
- Browser verification recipe. Open a program with scheduled workouts in at least two weeks and
  expand **Week-by-week states**. Compare each row's four state counts with the Calendar; weeks
  with no scheduled workouts are omitted, and a block with no scheduled workouts shows an empty
  state.

## Cycle 36 — Make empty training weeks explicit

The weekly state table now covers the full finite program block, plus the current and furthest
scheduled week for open-ended programs. Consecutive weeks with no scheduled workouts appear as a
single labeled range with zero counts in all four state columns. This makes a gap explicit for
review without inferring whether it was intentional, while keeping long empty stretches compact.

- The real-API browser journey schedules workouts in Weeks 1, 2, and 4 of a four-week block and
  confirms Week 3 appears with zero counts on desktop and phone. Temporary schedules and audit
  rows were removed, and the unique run tag was verified absent from the SQLite database.
- `uv run pytest -q` passed all 739 backend tests; `npm test` passed all 225 frontend tests.
  ESLint, TypeScript, Vite build, required Ruff, Ruff format, mypy, and `git diff --check` passed.
  Full localhost Playwright passed 78 tests with eight expected viewport skips.
- Browser verification recipe. Create a four-week program, schedule workouts in Weeks 1, 2, and
  4, then expand **Week-by-week states**. Confirm Week 3 is present as a zero-count gap; also
  confirm the current week and final block week remain visible when they have no scheduled work.

## Cycle 37 — Compare weekly volume by movement pattern

Training load now breaks actual gym volume down by each catalogue exercise's single primary
movement pattern, alongside the existing primary-muscle view. The API matches logged exercise
names and aliases using the catalogue's existing rules. Exercises without a pattern stay in an
Unclassified row; their volume is not guessed or spread across secondary movement tags. The
classified and unclassified rows sum to the same weekly external-volume total.

- Backend coverage verifies alias matching, squat and hinge assignments, the unclassified bucket,
  and exact reconciliation to weekly total volume. The real-API browser journey checks the labeled
  movement-pattern table for a classified week and an unclassified week on desktop and phone.
- `uv run pytest -q` passed all 740 backend tests; `npm test` passed all 225 frontend tests.
  ESLint, TypeScript, Vite build, required Ruff, Ruff format, mypy, and `git diff --check` passed.
  Full localhost Playwright passed 78 tests with eight expected viewport skips. E2E records were
  removed and the unique run tag was verified absent from the temporary SQLite database.
- Browser verification recipe. Log workouts using catalogue exercises with different primary
  movement patterns, then open **Training load**. Compare one week's pattern volumes with total
  weekly volume; select a week containing free-text exercises and confirm those loads remain under
  Unclassified.
