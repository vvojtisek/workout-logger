# Deployment simplification and product roadmap

Status: accepted, 2026-10-14. Supersedes Stages 8–9 of
`docs/health-tracker-implementation-instructions.md`.

**Progress (2026-10-14):** v2.0.2 runs on the shared EC2 host through the `deploy/aws` Compose
path at `https://fitness.vvojtisek.eu`. k3s never served production, so M0 and D3 are void (no
data to migrate). D4 (remove Kubernetes, Compose-based E2E) is the current slice; D1 is reduced
to pulling by digest and host-agnostic settings because the Compose path already works.

Original proposal text follows. It also superseded the k3s/Argo CD sections of `README.md` and
Stages 8–9 of `docs/health-tracker-implementation-instructions.md` once accepted.

## 1. Goal, restated as requirements

| # | Requirement | Current state |
|---|---|---|
| R1 | Log a workout from a phone with minimal taps | Built: `/workout` active session, PWA, offline queue |
| R2 | Review results and plan on a PC | Partial: history list, calendar; no progress analytics |
| R3 | Upload/import exercises in bulk | Missing (export only) |
| R4 | Define a 1–2 month block, then rotate to the next block automatically | Missing: programs are dated containers filled by hand |
| R5 | "Click → session": pick home/office/gym, get a session that respects equipment, recent history, style, injuries | Missing: no locations, equipment entity, preferences, restrictions, or generator |
| R6 | Expose data to an LLM | Partial: MCP server exists but is disabled in production and not scoped per account |
| R7 | Family/close friends only, non-commercial, low maintenance | Built: invite-only, ≤10 accounts |
| R8 | Easy to redeploy on a different server | Not met: deploy is welded to one EC2 instance and to chem-app |
| R9 | Containers; learn CI/CD | Met, with far more machinery than R7 justifies |

## 2. Architecture review: what to change and why

### Keep

* **FastAPI + SQLAlchemy + SQLite (WAL, single writer).** Right choice for under 10 users. Postgres
  would add a second stateful container, credentials, and a migration for no measurable gain.
  Drop "migrate to PostgreSQL" from the roadmap unless concurrent-writer contention is observed.
* **React + Vite PWA served by FastAPI.** One container and one origin, with no CORS. The mobile
  workout screen and offline queue are the hardest part of the product, and they already work.
* **Alembic migrations, invite-only auth, per-account API tokens, OIDC from GitHub to AWS, SSM instead
  of SSH, immutable image tags, automatic pre-migration backup and rollback in
  `scripts/deploy-aws-release.sh`.** These are good and carry over.
* **Do not rewrite from scratch.** About 7.5k LOC of backend, 8k of tests and 9k of frontend
  already cover R1 and R7. Everything missing (R3–R6) is new domain logic, which a rewrite would not
  give you for free. A rewrite would cost months and deliver nothing new.

### Change

| # | Decision today | Problem | Replacement |
|---|---|---|---|
| C1 | **Two production deploy paths for one hostname**: k3s + Argo CD + Helm (`README.md`) *and* Compose + SSM on the shared chem-app EC2 (`deploy/aws`). Both claim `fitness.vvojtisek.eu`. | Two pipelines to keep green, two sources of truth for "what is live", two backup mechanisms. This is most likely why deployment feels hard. | **One path: Docker Compose.** Delete `helm/`, `deploy/argocd`, `deploy/k3s`, the kubeconform job, the k3d E2E job and `scripts/promote_image.py`. |
| C2 | k3s + Argo CD on a 2 GiB node | The control plane needs more RAM than the app. `deploy/k3s/README.md` documents API timeouts, swap and kubelet reservations as workarounds. | Compose uses about 0 MB of overhead. The app container is capped at 512 MB. |
| C3 | Promotion PR after every `main` push | 21 of the last 51 commits are `chore(deploy): promote …`. Noise in history and an extra CI round-trip for each change. | Version is the Git tag. `main` builds `:sha-<short>`. A tag re-tags that digest (build once, deploy the same bytes). |
| C4 | Image shipped as a `docker save` tarball in GitHub Release assets, then `docker load` on the host | Multi-hundred-MB assets per release, an architecture-matching bug (PR #123), and a custom checksum layer that re-implements registry digests. | `docker pull ghcr.io/vvojtisek/workout-logger@sha256:…`. Make the GHCR package public (the image holds no secrets) or give the host a read-only `read:packages` token. |
| C5 | Deploy script hard-requires chem-app's Caddyfile, its Docker network, a fixed instance ID and a fixed hostname | Fails R8: the app cannot start on any other host. | Self-contained stack: `app` + `caddy` (optional profile) + `litestream`. Domain, proxy network and image come from `.env`. |
| C6 | Backups stay on the same instance (`/srv/workout-logger/backups`). Off-site copy is "a separate operations task". | Losing the instance or its volume loses all data. This is the single largest real risk in the current setup. | **Litestream** replicates SQLite continuously to S3 (or any S3-compatible store). Restoring onto a new host is one command, which also delivers R8. Keep the pre-migration snapshot. |
| C7 | MCP auth goes through Auth0 with an allowlist of identities, and MCP tools ignore account ownership (`docs/account-data-ownership.md`) | Adds an external IdP, 7+ secrets, and a cross-account data leak once enabled. Currently disabled in production, so R6 is unmet. | The MCP server authenticates with the **existing per-account API tokens** (bearer) and runs every tool in that account's scope. Add OAuth with the app as its own authorization server later, and only if a hosted client needs it (§5, L3). |
| C8 | Nutrition, sleep, steps and body metrics are about 35–40% of the code | Not in the stated goal. Each one adds migrations, tests and UI to maintain. | Freeze them: no new work, and hide them from the main nav behind a setting. Do not delete them; they work and are tested. |
| C9 | `FROM node:slim` and `python:3.11-slim` are unpinned or near EOL | Builds are not reproducible. Python 3.11 reaches end of life in Oct 2027. | Pin `node:22-slim` and `python:3.13-slim` (or 3.12) by digest, with Renovate/Dependabot updating them. |

Also unclear from the repo: **which database is live**, the k3s PVC or `/srv/workout-logger/data`.
§4 step M0 resolves this before anything is deleted.

## 3. Target deployment architecture

```text
                Internet :443
                     │
 ┌───────────────────▼────────────────────── any Linux host with Docker ─┐
 │  caddy (profile "edge"; TLS-ALPN-01, so only :443 needs to be open)    │
 │     │ reverse_proxy app:8000                                          │
 │  app  ghcr.io/vvojtisek/workout-logger@sha256:…                       │
 │     │ /data/workout_logger.db (bind mount ./data)                     │
 │  litestream ── continuous WAL replication ──► s3://<bucket>/workout   │
 └───────────────────────────────────────────────────────────────────────┘
```

* On the shared chem-app host, run without the `edge` profile and set `PROXY_NETWORK=chem-app_public-net`.
  chem-app's Caddy keeps owning :443. On a dedicated host, enable `edge`. Choosing between the two
  should be an `.env` setting, not a code change.
* Cheapest AWS fits: a `t4g.small` (2 GiB, ARM) is comfortable once k3s is gone, and `t4g.micro`
  (1 GiB) is probably enough. Lightsail is a simpler flat-price alternative. Check current pricing
  yourself; I have not verified it.
* TLS: Caddy's default ACME flow includes TLS-ALPN-01 on :443, so the existing HTTPS-only security
  group still works and the Route 53 DNS-01 plugin (a custom Caddy build) becomes unnecessary.

### Repository layout after the change

```text
deploy/
  compose.yaml            app + caddy(profile edge) + litestream; no host-specific values
  Caddyfile               {$DOMAIN} { encode zstd gzip; reverse_proxy app:8000 }
  litestream.yml          dbs: /data/workout_logger.db → s3 replica from env
  .env.example            DOMAIN, IMAGE, PROXY_NETWORK, API_KEY, LITESTREAM_* …
  bootstrap-host.sh       install Docker, create /srv/workout-logger, chown 10001, restore from S3 if empty
  deploy.sh <image-ref>   pull → snapshot → up --wait → verify /health commit → rollback on failure
  aws/                    (optional, phase D5) OpenTofu: instance, SG, IAM role, S3 bucket, DNS
```

`deploy.sh` is generic and the transport is swappable: SSM on AWS (keep the current OIDC role), or
SSH/Tailscale elsewhere. Moving servers takes four steps: run `bootstrap-host.sh` (which restores from
S3), copy `.env`, change DNS, and change one CI variable.

## 4. CI/CD pipeline (target)

| Trigger | Jobs | Outcome |
|---|---|---|
| Pull request | `backend` (ruff, mypy, pytest), `frontend` (lint, typecheck, vitest, build), `security` (pip-audit, npm audit, gitleaks) | Required checks |
| Pull request | `compose-e2e`: build the image, `docker compose up` with the **same** `deploy/compose.yaml`, run the Playwright journey against it, tear down | Tests what is actually deployed (replaces the k3d job) |
| Push to `main` | Build multi-arch once, push `:sha-<short>` and `:main`, Trivy scan and SBOM on that digest | Image ready, nothing deployed |
| Push tag `vX.Y.Z` | Resolve the digest of `:sha-<short>` for the tagged commit, add tag `:vX.Y.Z` (no rebuild), create the GitHub Release (notes only) | Versioned artifact |
| Release published / `workflow_dispatch` | `deploy` job in the `production` environment (manual approval optional): OIDC → SSM `deploy.sh ghcr.io/…@sha256:…` → curl `/health` and assert `commit` | Deployed; rollback = dispatch with the previous tag |
| Nightly (optional) | Restore the latest Litestream replica into a throwaway container and run `scripts/validate_backup.py` | Backups proven, not assumed |

CI/CD concepts this still teaches: build-once/promote-by-digest, environments with approvals,
keyless cloud auth (OIDC), concurrency groups, post-deploy verification, automated rollback,
backup verification, and optionally infrastructure as code (D5).

### Migration from today (each step is one PR, per `AGENTS.md`)

* **M0 – Inventory (no code).** Find where production traffic and data really go: `dig
  fitness.vvojtisek.eu`, `curl https://fitness.vvojtisek.eu/health` (the commit/version shows which
  pipeline produced it), `kubectl get pvc -n prod` on the k3s node, `ls -la /srv/workout-logger/data`
  on the chem-app host. Take a verified backup of the live DB (`scripts/backup_database.py`) and copy
  it off the instance (S3 or your PC) **before** any later step.
* **D1 – Self-contained Compose stack.** Add `deploy/compose.yaml`, `Caddyfile`, `.env.example` and a
  generic `deploy.sh` that pulls from GHCR by digest. Keep the existing pre-migration backup and
  rollback logic from `scripts/deploy-aws-release.sh`. Add the `compose-e2e` CI job. Remove tarball
  release assets.
* **D2 – Off-site backups.** Add a Litestream sidecar, an S3 bucket with versioning and a 30-day
  lifecycle, an IAM user or instance role restricted to that bucket prefix, `bootstrap-host.sh` that
  restores when `data/` is empty, and the nightly restore-verification job. Rehearse once: bring up a
  second host from S3 only.
* **D3 – Cut over.** If k3s is live: stop Argo auto-sync, back up, copy the DB to the Compose host,
  deploy, switch DNS, and verify `/health`. Then stop k3s and remove the instance (or run
  `k3s-uninstall.sh`) once a week passes without incidents.
* **D4 – Delete Kubernetes.** Remove `helm/`, `deploy/argocd`, `deploy/k3s`, the
  `scripts/promote_image.py` flow, the k3d and kubeconform jobs, and the Kubernetes sections of
  `README.md` and `AGENTS.md`. Expect roughly 1.5k lines removed.
* **D5 – (Optional, for learning) Infrastructure as code.** Use OpenTofu/Terraform for the instance,
  security group, SSM instance profile, GitHub OIDC deploy role, S3 bucket and Route 53 record. This
  reproduces the whole AWS side in one `tofu apply`.

## 5. Product roadmap (after D1–D3)

The generator should be **deterministic rules, not an LLM call at request time.** That keeps it
predictable, testable and usable offline at the gym, at no per-click cost. The LLM's role is
analyst and planner (L1–L3): it reads history and proposes the next block, and you accept it in the UI.

### P1 – Locations, equipment, profile (data foundation)

* `equipment` tag vocabulary (seeded): `bodyweight, dumbbell, adjustable_dumbbell, kettlebell,
  barbell, rack, bench, pullup_bar, cable, band, trx, machine:<name>, treadmill, bike, rower …`
* `location` (per account): name, kind (`home|office|gym|travel`), equipment tags, default session
  length in minutes. Seed Home/Office/Gym.
* `exercise` gains `slug` (unique), `equipment_any_of` (a list of alternative tag-sets, e.g.
  `[["dumbbell","bench"],["barbell","bench","rack"]]`), `movement_pattern`
  (`squat|hinge|lunge|h_push|v_push|h_pull|v_pull|carry|core|conditioning|mobility`), `load_mode`,
  `impact` / `spinal_load` flags. Muscles already exist.
* `profile` (per account): training style (`strength|hypertrophy|circuit|mixed`), sessions per week,
  preferred and disliked exercises, and variation policy (`keep_main_lifts`, `rotate_accessories`).
* `restriction` (per account): label ("left shoulder"), excluded movement patterns, flags, or
  exercises, an optional per-exercise substitution, active from/until. Restrictions are hard filters,
  never soft scores.

### P2 – Bulk import

* `POST /api/v1/exercises/import` takes CSV or JSON, upserts by `slug`, supports dry-run, and returns a
  diff. The same endpoint is exposed as an MCP tool, so an LLM can generate a catalogue and you review
  the diff before applying it.
* Ship a seed file of about 150 common exercises with equipment and pattern tags.

### P3 – Block templates and rotation ("set it and revisit in 3 months")

* `block_template`: name, weeks (4–8), style, and an ordered list of **slots**. A slot describes a
  movement pattern and dose, not a fixed exercise (e.g. *Day A: squat 4×5–8, h_push 3×8–12, h_pull
  3×8–12, core 2×*). Optionally pin a specific exercise per slot.
* `rotation`: an ordered queue of block templates per account. When a block's weeks end, the next one
  starts automatically. A deload week between blocks is optional.
* Progression rule per slot: double progression (add reps up to the top of the range, then add load
  and reset). It needs only the last 1–3 performances, which `_latest_history` in
  `app/services/workout_sessions.py` already approximates.
* Existing `program` / `scheduled_workout` stay. The calendar is a view of generated sessions, not
  something you fill by hand.

### P4 – Session generator (the "click" button)

`POST /api/v1/sessions/generate {location_id, minutes?}` returns a preview. On accept, it starts a
normal `WorkoutSession`, so the existing mobile UI is reused unchanged.

1. Pick the next day template in the active block: the one least recently done this week (round-robin).
2. For each slot, filter candidate exercises to `movement_pattern == slot.pattern`. A candidate
   qualifies if **any** of its `equipment_any_of` sets is a subset of the location's equipment and it
   passes every active restriction.
3. Rank the candidates:
   1. The exercise you did for this slot last time, if `keep_main_lifts`, so progression is measurable.
   2. Exercises you prefer.
   3. Exercises with the least recent use, if `rotate_accessories`.

   Drop exercises you dislike.
4. Set targets from that exercise's history using the progression rule. If there is no history, start
   at the bottom of the rep range with RIR 3.
5. Fit the time budget: drop the lowest-priority slots or sets until the estimated time ≤ `minutes`.
6. Weekly balance check: if a muscle group is already over its weekly set target from earlier
   sessions, cut its accessory volume.
7. Return the preview, with a one-line reason per exercise ("dumbbell bench: barbell unavailable at
   Home"). If no exercise fits a slot, show the slot as "no fit" instead of silently skipping it.

Phone UI: a home screen with three location buttons, then the preview, then Start. That is two taps
to a session.

### P5 – Results on PC

Weekly sets per muscle group versus target, estimated 1RM trend per main lift, adherence
(planned vs done sessions), block summary at block end. Read-only pages: no new write paths.

### LLM exposure

* **L1 – Fix scoping first.** MCP tools run inside the authenticated account's scope (closes the gap
  documented in `docs/account-data-ownership.md`). Authenticate with existing per-account API tokens
  as `Authorization: Bearer …`. This works today with Claude Code, Claude Desktop and other MCP
  clients that send custom headers. Delete the Auth0 provider path.
* **L2 – Useful tools.**
  * Read: `get_profile` (locations, restrictions, preferences), `get_history(from, to)`,
    `get_weekly_summary`, `get_block_status`, `list_exercises(filter)`.
  * Write (drafts only): `import_exercises(dry_run)`, `propose_block_template`. A proposal lands in
    the UI as a draft you accept. The LLM never activates anything itself.
* **L3 – Hosted connectors (only if needed).** Web-based connectors in claude.ai / ChatGPT
  expect OAuth. If you need them, make the app its own OAuth 2.1 authorization server, backed by the
  existing login, instead of Auth0. I am not certain what each vendor currently requires; check
  their docs at implementation time.
* **No-code fallback.** `GET /api/v1/llm/context.md?weeks=4` returns a compact Markdown digest
  (profile, restrictions, last N weeks, current block). You can paste it into any chat model.

## 6. Order of work and rough size

| Order | Slice | Size | Unlocks |
|---|---|---|---|
| 1 | M0 inventory and off-instance backup | hours | Safety |
| 2 | D1 Compose stack + compose-e2e | 1–2 days | R8, one pipeline |
| 3 | D2 Litestream + restore rehearsal | 1 day | Data safety, R8 |
| 4 | D3 cut-over, D4 delete k8s | 1 day | Less to maintain |
| 5 | L1 MCP scoping + bearer tokens | 1 day | R6 (basic) |
| 6 | P1 locations/equipment/profile/restrictions | 2–3 days | Foundation |
| 7 | P2 import + seed catalogue | 1–2 days | R3 |
| 8 | P3 block templates + rotation | 3–4 days | R4 |
| 9 | P4 generator + location buttons | 3–5 days | R5 |
| 10 | P5 analytics, L2 tools | 2–4 days | R2, R6 |
| – | D5 OpenTofu | optional | Learning |

## 7. Open questions for the owner

1. Which deployment serves `fitness.vvojtisek.eu` today, and where is the live database (M0)?
2. Is the k3s node a separate EC2 instance from the chem-app host?
3. Stay co-located with chem-app (shared Caddy) or move to a dedicated small instance?
4. Is making the GHCR image public acceptable? If not, a read-only token on the host is required.
5. Which LLM clients do you actually want to connect? This decides whether L3 is needed.
6. Should nutrition/sleep/body-metrics be hidden (C8) or are they in use by someone in the family?
