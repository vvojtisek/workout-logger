# SPEC-UX: UI/UX Refactor

Status: **draft for review. No application code has been written.**
Branch: `feat/ux-ui-overhaul` · Rules: `CLAUDE.md` (UI/UX Overhaul Rules) · Delivery: `AGENTS.md`

## 1. Objective

Make the app usable with one thumb between sets, and useful as a review tool at a desk.

| Mode | Device | Job | Success looks like |
|---|---|---|---|
| **A. Active Gym Floor** | 360–412px phone, one hand, sweaty, glanced at | Log a set in 1 tap, always see the rest timer, never wait on the network | Repeat set = 1 tap; timer visible on every screen while running; 0 horizontal scroll |
| **B. Analytics & Planning** | 1280px+ desktop | Review history, see progression and balance, edit plans | Multi-pane dashboard; volume and muscle split visible without clicking into anything |

Non-goals: scroll-driven marketing sections, hero banners, new backend features, new auth, anything in the
deferred list of `docs/active-workout-feature-plan.md`.

## 2. Audit: what is wrong today

**Method.** Real stack, not mocks: FastAPI on `:8011` (`:8000` was already taken by another process I did not start),
throwaway SQLite DB, seeded "Push Day A" (5 exercises, 16 sets, one superset) through the real API, driven with
`playwright-cli` at 390x844 and 1440x900. Measured with `getBoundingClientRect` and `document.fonts`. Screenshots were
reviewed but are not committed.

**Not audited:** Plans, Calendar, Nutrition, Sleep, Settings, light theme, a populated History, real-device touch.
Findings below are limited to Today, the live workout and (empty) History.

### 2.1 Mobile (390x844) — what already works

- No horizontal overflow (`scrollWidth` = `clientWidth` = 390).
- Steppers are instant and exact: 10 rapid `+2.5` clicks gave 105 kg (80 + 25) in 316 ms; 5 rapid `+1` gave 10 reps.
- Primary action is a full-width 54px button in the lower third. Good thumb placement.
- The 48px touch token (`--touch`) and a `.btn-touch` class already exist.

### 2.2 Mobile — problems

| # | Finding | Evidence |
|---|---|---|
| M1 | **Touch targets below the 44px floor.** RIR pills 65x**40**; weight/reps inputs 147x**40**; "Skip set" 78x**36**; rest bar `−15s`/`+15s` **47x40**, "Skip Rest" 72x**40**. Steppers are 70x44: legal, but small for the most-used control. | `getBoundingClientRect` on `/workout` |
| M2 | **Rest timer is not persistent.** It is a row inside the HUD that *replaces* the Complete button's slot, so the primary control moves under the thumb the moment it is used. Minimizing the workout returns to Today with no timer; the only trace is a green dot on the Today tab. | `m-rest.png`, `m-min.png` |
| M3 | **Top ~45% of the screen is empty** while the controls are crammed into the bottom. For a first set there is no useful content there: no last-session numbers, no logged-set trail, no next exercise. | `m-workout1.png` |
| M4 | **Noisy status copy** in warn-amber on every state ("Suggested from plan · not saved", "Repeating set 1 · not saved") and a permanent two-line RIR explainer taking ~40px above the primary button. | `m-rest.png` |
| M5 | **Today is a card stack** (3 stat tiles, coach, sleep with 4 steppers, food) before anything workout-related is reachable besides the one coach card. | `m-today.png` |

### 2.3 Desktop (1440x900) — problems

| # | Finding | Evidence |
|---|---|---|
| D1 | **Today is the mobile column, stretched and left-aligned.** Capped at `max-w-5xl` (`AppLayout.tsx:398`), leaving ~230px of dead space on the right and nothing to read beyond three tiles. No analytics anywhere. | `d-today.png` |
| D2 | **Set grid rows are uneven.** Set 2 is 88px tall; sets 3–4 are ~137px because the action cell wraps "Open" under the inputs (`ROW_GRID` is a fixed 6-column grid with `min-w-[38rem]`, `SetRow.tsx:44`). | `d-workout.png` |
| D3 | **"Previous" column shows the plan target, not the previous performance.** The cell renders `suggested_weight_kg × suggested_reps` (`SetRow.tsx:356`). After logging 105 kg × 10, set 2 still reads "80 kg × 5". | `d-workout.png` |
| D4 | **Rest timer is below the fold** (y≈700+ at 900px height), shown as raw seconds ("Rest: 133s") in a full-width card, next to a "Synchronized" status line. | `d-workout.png` |
| D5 | **History is list + empty pane only.** No volume progression, no muscle-group split. The data inputs exist (`primary_muscles`/`secondary_muscles` on exercises, `/exercise-stats`); no volume/muscle aggregation route exists in `app/api/v1/`. | `d-history3.png`, `app/models/exercise.py:41` |
| D6 | **Deep link to `/history` during an active workout landed on `/workout`.** Clicking the sidebar link works. Cause not investigated. | `playwright-cli goto` vs sidebar click |

### 2.4 Typography and system

| # | Finding | Evidence |
|---|---|---|
| T1 | **JetBrains Mono does not load.** Vite inlines a small font subset as a `data:` URI and the CSP (`default-src 'self'`, no `font-src`) blocks it: `document.fonts` reports `JetBrains Mono Variable: error` and the console logs a CSP violation on every page. Weights, reps and timers silently render in the system monospace fallback. | Console log; `document.fonts`; `app/main.py:77` |
| T2 | **Console is never clean.** Besides T1, every cold load logs a 401 on `/auth/me` and, with no session, a 404 on `/workout-sessions/active`. Both are expected API behaviour but fail the "zero console/network errors" gate as written. | `playwright-cli console` |
| T3 | **Hierarchy is flat.** Tiny uppercase labels (~11–12px), a 16px body and one big number; the exercise name, set counter and timer compete at similar weight. The timer is the least prominent thing on mobile while resting. | all screenshots |
| T4 | Two families (Inter, JetBrains Mono) already satisfy the "max 2" rule; the problem is that one of them is not rendering (T1), not the count. | `tokens.css` |

## 3. Design contract (applies to both modes)

Source: `taste.md`, `feel.md`, `devices.md` from the scroll-craft skill (plugin cache; see Open Questions on the path).
Only the *system* rules are taken; nothing scroll-driven.

- **Spacing:** 4px base scale only (4, 8, 12, 16, 20, 24, 32, 48). No ad-hoc pixel values. Space above a group > space below its heading; group by proximity before adding a border.
- **Type:** Inter (UI) + JetBrains Mono (all digits that count: weight, reps, RIR, timers, volume). `font-variant-numeric: tabular-nums` on every counting element. Keep Inter: the references discourage it as a *default*, but allow it when accessibility/neutrality is the brief, which is true for a gym utility.
- **Dark-mode compensation** (light-on-dark): +0.05 line-height, +0.01em tracking, one weight step up on text <16px. Secondary text tinted from the surface hue, never flat grey. No `#000`.
- **Contrast** measured on the render: body ≥ 4.5:1, large text and controls ≥ 3:1, focus ring ≥ 3:1.
- **No card clutter:** one container level maximum. Rows separated by spacing and hairlines. A border/card only for something that is actually a separate object (the rest bar, a dialog).
- **Accent discipline:** primary blue = the one next action. Green = done. Amber = needs attention only (not "not saved"). Existing tokens in `frontend/src/styles/tokens.css` stay.
- **Motion:** <200 ms, opacity/transform only, off under `prefers-reduced-motion`, hover effects gated to `(hover: hover)`.
- **Touch:** every interactive element ≥ 44x44; primary and stepper controls ≥ 48 (existing `--touch`).

## 4. Mode A — Active Gym Floor (mobile-first)

### 4.1 Anatomy at 390x844

```
┌────────────────────────────┐  0
│ Push Day A   00:21:08  ⌄   │  top bar (status only, ≤ 48px)
│ ▓▓▓░░░░░░░ 3/16            │
├────────────────────────────┤
│ Barbell Bench Press        │  READ ZONE (top ~35%)
│ Set 2 of 4  · A1 superset  │  exercise, set, last-time numbers,
│ Last: 100×5, 100×5, 97.5×6 │  logged sets this session, next up
│ ✓ 105×10   ✓ 105×8   ·     │
│ Next: Incline DB Press     │
├────────────────────────────┤
│   WEIGHT kg      REPS      │  ADJUST ZONE (middle)
│  [−] 105.0 [+]  [−] 8 [+]  │  steppers 56px, value is tap-to-type
│  RIR  0  1  2  3  4+       │  pills 48px
├────────────────────────────┤
│ [ ✓ LOG SET   105 × 8    ] │  ACT ZONE (bottom 25%, thumb arc)
│  Skip      ← →             │  fixed position, never swaps
├────────────────────────────┤
│ REST 02:08  −15 +15  Skip  │  persistent rest bar (see A3)
└────────────────────────────┘
```

### 4.2 Requirements

**A1 — Thumb zone.** Anything pressed during a set sits in the lower 50% of the viewport. Read-only context goes above it and fills the empty upper area (M3). The Log button keeps one position, size and label for the entire set cycle.

**A2 — One-tap repeat, minimal-tap change.** `Log set` prefilled from (in order) the previous set of this session, last session's same set, then the plan target. Steppers: weight ±2.5 (overridable per exercise: 1 / 1.25 / 2.5 / 5), reps ±1. Tapping the number opens the numeric keypad. RIR is optional and defaults to the previous set's value; leaving it untouched must not block logging.

**A3 — Persistent bottom rest bar.** Own component mounted at the app shell, not inside the HUD, so it survives minimize and route changes (fixes M2). Fixed above the safe-area inset (`env(safe-area-inset-bottom)`), shows mm:ss in mono, `−15`, `+15`, `Skip`, all ≥ 44px. Starts in the same frame the set is logged. Never replaces or moves the Log button. On finish of rest: one non-modal visual cue (and vibration where supported), no blocking dialog. Must keep working after reload (existing resilience behaviour, `e2e/rest-timer-resilience.spec.js`).

**A4 — Zero-latency optimistic updates.** On `Log set`: (1) row flips to *logged* locally, (2) rest timer starts, (3) next set prefilled, all in the same frame, before any network round trip; (4) persisted to the existing IndexedDB store and sent through the existing API; (5) on success reconcile silently; (6) on failure keep the local state and show a small inline "Retry" on that set, never a blocking error. Stepper presses update the displayed value synchronously. Undo (existing 5 s) stays. Budget: tap → painted change ≤ 100 ms, measured with Playwright performance marks.

**A5 — Quiet status.** Replace "Suggested from plan · not saved" and "Repeating set 1" with a single muted dot/label only when the values deviate from the prefill. Collapse the RIR explainer behind a `?` control. Connection state appears only when offline or retrying.

**A6 — Today as a launcher, not a dashboard (phone).** Order: active/next workout (primary), then one-tap quick logs (sleep, hockey, repeat meal), then summaries. No more than one container level.

**A7 — Keeps working:** all existing accessible names (`Complete … set N`, `Skip …`), `data-set-row`/`data-state` attributes and API contracts, so current E2E specs still pass unmodified unless a spec is listed in the slice.

## 5. Mode B — Analytics & Planning (desktop 1280px+)

### 5.1 Layout

A multi-pane dashboard that is a different composition from mobile, not a wider column:

```
┌ rail ┬──────────────────────────────┬─────────────────────────┐
│ 220  │ Sessions (history list)      │ Selected session detail │
│      │ filter: range · plan · type  │ sets table, volume, PRs │
│      ├──────────────────────────────┴─────────────────────────┤
│      │ Volume progression (8–12 wk)  │  Muscle-group split     │
│      │ weekly sets/tonnage, per lift │  sets per muscle / 7 d  │
└──────┴────────────────────────────────┴────────────────────────┘
```

### 5.2 Requirements

**B1 — Dashboard home (desktop `/today`).** At ≥1280px the page uses the full width in 12 columns: left column = today (next workout, readiness inputs); right = volume progression + muscle split + recent sessions. Remove the `max-w-5xl` cap for this route (D1).

**B2 — Session history (master-detail kept).** Keep the existing list/detail split; add date-range and plan filters and show volume (sets × reps × kg) and best set per row so the list is scannable without opening it.

**B3 — Volume progression.** Weekly total sets and tonnage over the last 8–12 weeks, switchable per exercise. Plain SVG/CSS chart with mono tabular labels; no chart dependency without approval.

**B4 — Muscle-group split.** Sets per primary muscle (secondary at half weight, stated on the panel) for the last 7 and 28 days, as horizontal bars, sorted descending, with an "under-trained" marker for muscles at 0.

**B5 — Active workout on desktop (fix D2–D4).** Same two panes, but: fixed-height rows with the actions in one non-wrapping cell; **Previous = last session's same set**; rest timer as a sticky bar at the bottom of the workout pane in mm:ss (not a card below the fold); drop repeated amber copy.

**B6 — Planning.** Proposed, **not yet audited**: Plans becomes list | editor | exercise-catalogue picker so a plan can be built without page changes. Confirm scope before a slice is written (see Open Questions).

**B7 — Data.** Prefer client-side aggregation of existing `/logs` and exercise-catalogue data. A new aggregation endpoint is only added if profiling shows the client path is too slow, and only with explicit approval (rule 1 of the overhaul rules permits new *query parameters*, not new endpoints).

## 6. Tech stack, commands, structure

Stack (unchanged): React 19, Vite 8, TypeScript, Tailwind 4, TanStack Query, react-router 7, FastAPI + SQLite.

```
Install:      npm ci
Dev (HMR):    npm run dev                      # proxies /api to :8000
Build:        npm run build                    # -> app/static/dist (served by FastAPI)
Unit (FE):    npm test
Lint/types:   npm run lint && npm run typecheck
Backend:      pytest --cov=app --cov-report=term-missing
              ruff check --select E4,E7,E9,F .
E2E:          npx playwright test e2e/<spec>.spec.js
Local stack:  uv run alembic upgrade head && uv run uvicorn app.main:app --port 8011
Gate:         playwright-cli open http://127.0.0.1:8011 ; resize 390 844 ; resize 1440 900
```

Where things go: tokens in `frontend/src/styles/tokens.css`; shared primitives in `frontend/src/ui/`; workout in `frontend/src/features/active-workout/`; new rest bar in `frontend/src/features/active-workout/RestBar.tsx` mounted from `AppLayout.tsx`; new dashboard panels in `frontend/src/features/dashboard/`; pure logic and aggregation in `frontend/src/lib/` with `*.test.js` beside it.

Code style: follow the existing files; semantic tokens only, no raw hex, 4px scale utilities, mono for digits.

```tsx
<span className="font-mono tabular-nums text-2xl tracking-tight" data-numeric>
  {formatRest(secondsLeft)}
</span>
```

## 7. Delivery slices (one PR each, per `AGENTS.md`)

Order is by value and dependency. Tests first, observed failing, per `AGENTS.md`.

| Slice | Scope | Verifies |
|---|---|---|
| **S0** | Make fonts load without touching the CSP (set Vite `build.assetsInlineLimit` to 0 for fonts, or equivalent); decide the 401/404 console noise (T1, T2) | `document.fonts` all `loaded`; console clean on cold load; `tests/test_static_pwa.py` untouched and green |
| **S1** | Mobile touch targets ≥ 44/48, RIR pills, skip, input heights; quiet status copy; RIR explainer collapse (M1, M4) | measured sizes; existing grid/HUD E2E green |
| **S2** | Persistent rest bar in app shell, fixed Log button (M2, A1, A3) | timer visible after minimize and route change and reload; Log button position constant |
| **S3** | Read zone: last-session numbers, logged-set trail, next exercise; prefill order (M3, A2) | fills upper area at 390x844; prefill unit tests |
| **S4** | Optimistic log with retry (A4) | tap→paint ≤ 100 ms; offline log then sync; undo still works |
| **S5** | Desktop workout grid: even rows, real "Previous", sticky rest bar (D2–D4, B5) | row heights equal; set 2 Previous = set 1 result |
| **S6** | Desktop dashboard shell + session list metrics (D1, B1, B2) | no `max-w-5xl` cap at ≥1280; multi-column at 1440 |
| **S7** | Volume progression + muscle split (D5, B3, B4) | numbers match seeded data exactly |
| **S8** | Today as launcher on phone (M5, A6) | Today ≤ 2 container levels; quick logs reachable in ≤ 2 taps |
| **S9** | Planning pane (B6), only after scope is confirmed | TBD |

## 8. Testing strategy

- **Unit (vitest):** prefill order, volume and muscle aggregation, mm:ss formatting, optimistic reducer states.
- **E2E (Playwright, real FastAPI + temp SQLite, no route mocking):** extend `e2e/active-workout-grid.spec.js`, `workout-hud.spec.js`, `rest-timer-resilience.spec.js`, `desktop-workout.spec.js`, `today.spec.js`; tag records with `TEST_RUN_ID`, delete and verify absence.
- **Per-slice `playwright-cli` gate (CLAUDE.md §4):** at 390x844 and 1440x900: screenshot, 10+ rapid stepper clicks with exact value assertion, zero console/network errors, all interactive elements ≥ 44x44 (scripted `getBoundingClientRect` sweep, fails the slice on any miss), `scrollWidth <= clientWidth`.
- **Contrast:** measured on the render for body, secondary text, controls and focus ring in dark; light theme checked at the end.

## 9. Boundaries

- **Always:** run vitest and pytest after each change; keep existing accessible names and data attributes; use tokens and the 4px scale; verify at both viewports before committing.
- **Ask first:** any new endpoint or schema change; any new npm dependency (including a chart library); loosening or changing the CSP; modifying an existing E2E assertion.
- **Never:** edit the CSP without updating `tests/test_static_pwa.py`; skip, weaken or delete a failing test; mock the API as acceptance evidence; build scroll-driven or hero sections; touch auth, MCP or migrations.

## 10. Success criteria

1. At 390x844 and 412x915 (and 360 wide): zero horizontal scroll; every interactive element ≥ 44x44; Log button never moves during a set cycle.
2. Repeating a set is **1 tap** from a fresh set; changing weight by ±2.5 is 1 tap; no keyboard needed for typical sessions.
3. Rest timer is visible and correct on every route while running, and after reload.
4. Tap → visible state change ≤ 100 ms with the network throttled to offline; the set syncs when back online.
5. At 1440x900: ≥ 3 panes of information without scrolling on the dashboard; no `max-w` cap; set rows equal height; "Previous" is a real previous.
6. Both fonts load; console and network are clean on a cold start; CSP and `tests/test_static_pwa.py` unchanged.
7. All existing unit and E2E suites pass without modification except those listed per slice.

## 11. Open questions (need your decision before slices are written)

1. **Reference path.** `CLAUDE.md` points to `.claude/skills/scroll-craft/references/`, which does not exist in this repo; the files are in the plugin cache (`~/.claude/plugins/cache/nateherk/nateherk-design/0.3.1/skills/scroll-craft/references/`). Copy the three files into the repo, or fix the path?
2. **Commit policy conflict.** The new rule says "atomic local commits after each verified slice"; `CLAUDE.md` and `AGENTS.md` say one PR per slice. Plan: one branch/PR per slice from `main`, not all slices on `feat/ux-ui-overhaul`. OK, or keep everything on the one branch?
3. **Console-error gate.** 401 on `/auth/me` and 404 on `/workout-sessions/active` are normal API answers. Allow-list them in the gate, or change the client to avoid the calls (e.g. a 204 "no active session", which is an API change)?
4. **Font fix.** OK to set `assetsInlineLimit: 0` for fonts (adds two font requests, no CSP change)?
5. **Aggregation.** Client-side from `/logs` (limit 100 today) is enough for 8–12 weeks only if the list includes per-set data. Needs a check; may force a new endpoint or `/logs` query parameter. Acceptable?
6. **Planning (B6).** Is the plan-builder redesign in scope for this overhaul? It was not audited.
7. **D6.** Investigate the `/history` → `/workout` redirect now, or file a separate issue?
