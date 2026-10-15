# Repository agent instructions

## Codex agent routing

Use `.codex/skills/adaptive-model-router/SKILL.md` to choose the least costly capable agent.
The coordinator owns scope, delivery gates, verification, and the final report. Prefer one
implementation owner for a coherent change and parallelize only independent exploration.

Use the scoped profiles in `.codex/agents/` for small mechanical work, normal implementation,
cross-layer features, difficult root-cause debugging, unusually hard unresolved problems, and
high-risk schema or deployment migrations. Active-workout slices must follow
`docs/active-workout-feature-plan.md`; that plan and the delivery rules below remain authoritative.

Repository-specific review priorities:

- preserve workout history and current plan/log API contracts;
- keep browser entry flows usable on a phone and readable during desktop review;
- treat SQLite backup, migration, and single-writer behavior as production invariants;
- keep session authentication, API-token scopes, and invited-account ownership distinct;
- validate deployment changes against `deploy/aws/compose.yaml` and the SSM release path; the
  merge E2E job runs that same Compose file.

Read `docs/active-workout-feature-plan.md` before implementing workout UI or active-workout features.

For active-workout work, that plan supersedes the stage sequencing in `docs/health-tracker-implementation-instructions.md`. The health-tracker document remains the long-term roadmap.

## Delivery rules

- Deliver one vertical feature slice at a time.
- Use one short-lived branch and one draft PR per slice, based on the latest green `main`.
- Do not proceed to the next slice until all required tests for the current slice pass.
- Write tests first and observe the intended failure before implementation.
- Integration and E2E tests must exercise the real FastAPI application, real API, migrations, and a real temporary SQLite database.
- Do not use browser route interception or mocked API responses as acceptance evidence.
- Tag generated records with a unique `TEST_RUN_ID`, delete them in cleanup, and verify absence.
- Never bypass, delete, weaken, or silently skip a legitimate failing test.
- After three unsuccessful fixes for the same root cause, stop and report evidence instead of looping.
- The frontend stack is React 19 + Vite + TypeScript, approved as the separate decision the previous
  rule required and recorded in `docs/gui-and-platform-expansion-plan.md`. Source lives in
  `frontend/src`; `npm run build` compiles it into `app/static/dist`, which FastAPI serves and which
  is a build artifact, never committed.
- Do not mix unrelated CI/CD, deployment, sleep, nutrition, PostgreSQL, multi-user, or framework work into a feature PR.
- Create a separate issue for non-blocking defects found during feature implementation.
- Preserve current plan/log API behavior and workout history unless an additive, tested migration replaces it.
- Use Conventional Commits.
- Do not commit secrets.
- Production changes only through tagged releases (`vX.Y.Z`) and the SSM deploy workflow; roll back by
  deploying the previous release tag, never by editing containers on the host.

## Active-workout Ruff baseline ratchet

- For active-workout slices, the required Ruff gate is `ruff check --select E4,E7,E9,F .`,
  matching the authoritative green CI baseline.
- Run `ruff check .` informationally. Newly created Python files must pass the full Ruff rules,
  no new violations may be introduced, and the known baseline must not get worse.
- Issue #28 records the pre-existing full-Ruff mismatch. It is non-blocking for active-workout
  slices and must not be fixed as part of those feature changes.
