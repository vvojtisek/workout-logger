# Repository agent instructions

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
- Keep the existing frontend stack for the active-workout MVP; do not begin a React/Vite rewrite unless a separate approved decision changes this.
- Do not mix unrelated CI/CD, Kubernetes, sleep, nutrition, PostgreSQL, multi-user, or framework work into a feature PR.
- Create a separate issue for non-blocking defects found during feature implementation.
- Preserve current plan/log API behavior and workout history unless an additive, tested migration replaces it.
- Use Conventional Commits.
- Do not commit secrets.
- Git is the Argo CD source of truth; do not deploy or roll back production with imperative Helm changes.
