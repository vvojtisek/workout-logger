---
name: adaptive-model-router
description: Route workout-logger work to the least costly capable Codex agent and escalate based on scope and evidence.
---

# Adaptive model router

The coordinator is GPT-6 Luna High. It owns scope, delivery gates, verification,
and the final report. Choose the least costly profile reasonably likely to
complete the work correctly; do not walk the full escalation ladder by default.

## Routing

- **Coordinator or `quick_worker` — GPT-6 Luna High:** repository inspection,
  documentation, formatting, mechanical edits, simple test repairs, and clear
  localized bugs. Do not delegate work the coordinator can finish directly.
- **`implementer` — GPT-6.1 Sol Medium:** normal issues, localized API or UI
  work, moderate bugs, and established-pattern changes.
- **`feature_engineer` — GPT-6.1 Sol High:** coordinated FastAPI/frontend work,
  persistence plus application logic, active-workout slices, authentication,
  and features with meaningful cross-layer impact.
- **`deep_debugger` — GPT-6.1 Sol XHigh:** unclear root causes, intermittent
  failures, SQLite locking/concurrency, production-only behavior, and
  deployment inconsistencies. Gather evidence before changing code.
- **`hard_problem_solver` — GPT-6 Astra Low:** only after serious evidence-based
  work at a lower level fails or assumptions need reconsideration.
- **`migration_architect` — GPT-6 Astra Medium:** high-risk schema/data,
  account-ownership, platform, or deployment migrations needing compatibility
  and recovery planning.

## Repository constraints

- Read `AGENTS.md` and the active-workout plan before changing workout flows.
- Keep feature slices vertical, test-first, and based on real API/database
  acceptance. Never weaken a legitimate failing test.
- Preserve existing plan/log APIs and workout history through additive,
  tested changes.
- Treat SQLite production as a single-writer deployment; plan and verify
  backups for migration-bearing releases.
- Do not infer account isolation from login. Verify API authorization and
  ownership filters for each data domain.
- Consider the React PWA on both desktop review screens and mobile workout
  entry flows.
- Keep feature changes separate from unrelated CI/CD, Kubernetes, or platform
  work, consistent with `AGENTS.md`.

## Escalation and parallel work

Escalation is evidence-based, not automatic. Do not repeat essentially the same
failed approach more than twice. Pass the next agent the objective, affected
areas, evidence, hypotheses tested, attempted changes, verification results,
known-good facts, open questions, and constraints.

Parallelize only genuinely independent exploration. Use one implementation
owner for overlapping code, and do not delegate merely to re-review work that
can be checked deterministically with tests, linters, builds, or direct
inspection.
