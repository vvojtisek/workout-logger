# GitOps staging and rollback runbook

Production is never a failure-drill target. Rollback changes Git's desired state and lets Argo CD
reconcile; `helm rollback`, direct Deployment edits, and imperative image changes are prohibited.
SQLite/Recreate releases can be unavailable for several minutes while migration, image pull,
startup, smoke validation, and recovery complete. That downtime is accepted at this stage.

## Staging bootstrap

`deploy/argocd/application-staging.yaml` defines `workout-logger-staging`, targeting the separate
`staging` namespace and `values-staging.yaml`. Apply the external secret before the first sync;
never put its value in Git or CI output:

```bash
kubectl create namespace staging --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic workout-logger-secret \
  --namespace staging \
  --from-literal=API_KEY='<dedicated-staging-key-at-least-32-characters>'
kubectl apply -f deploy/argocd/application-staging.yaml
```

The chart's existing PreSync migration also requires its ServiceAccount and data PVC on a fresh
namespace before normal Sync resources exist. Until that chart bootstrap limitation is fixed,
create those two resources from the rendered staging chart before the first Application sync.
This is bootstrap only; subsequent release changes remain GitOps reconciled.

Resolve `staging.workout-logger.local` to the ingress endpoint only on trusted local clients. The
staging API uses a dedicated API key; the application does not currently implement the proposed
username/password credentials.

## Last-known-good state

`environments/staging/release-state.json` records the immutable digest and source commit that have
passed Argo sync, Kubernetes readiness, and the tagged real-data smoke journey. It must match the
staging values file when the environment is stable. Do not update it merely because an image was
built or a promotion commit merged.

For a candidate release:

1. Open a reviewed PR changing only the staging `image.digest` and `image.sourceCommit` together.
2. Let Argo CD reconcile and wait for migration, Deployment availability, and all health probes.
3. Create a uniquely tagged plan and workout log through the real API; read/update them, then
   delete them in a `finally` cleanup and verify absence.
4. Preserve Argo operation state, Pods, events, migration output, health responses, smoke values,
   cleanup result, desired digest, and runtime image ID.
5. Only after every check passes, update `release-state.json` in a reviewed Git change.

## Failure and rollback

If migration, rollout, health, runtime-image verification, or the smoke journey fails, do not mark
the candidate stable. Run:

```bash
python scripts/rollback_release.py \
  --values helm/workout-logger/values-staging.yaml \
  --state environments/staging/release-state.json
```

Commit the resulting digest/source pair as `github-actions[bot]` with a message such as
`revert(staging): restore last-known-good release`, and push it to the Git branch Argo watches.
The command validates the state before changing the values file, so malformed or mutable release
identities cannot replace desired state. Wait for Argo to report the rollback commit Synced and
Healthy, verify the requested/runtime digest, repeat readiness and the tagged real-data journey,
and retain all failure/recovery evidence.

If recovery fails, stop promotions, leave the evidence and database PVC intact, and investigate.
Do not attempt an imperative Helm rollback. A schema incompatible with the LKG image requires the
SQLite restore maintenance procedure in `sqlite-backup-restore.md`.

## Automated rollback drill

`.github/workflows/rollback-drill.yml` runs for pull requests without package-write or repository-
write permission. It creates a runner-local k3d cluster, installs pinned Argo CD, and runs
`scripts/run_rollback_drill.py` against a temporary local Git remote. The drill:

- deploys the recorded LKG through real Argo CD;
- creates a tagged plan through the real API and file-backed SQLite database;
- pushes a Git commit containing a deliberately nonexistent immutable digest;
- requires the Argo PreSync operation to fail while the stable Deployment and record survive;
- invokes the rollback command and creates a bot-authored Git commit restoring the LKG pair;
- waits for Argo to converge to that rollback commit;
- verifies health and the persisted record, then deletes and verifies absence of test data;
- uploads the Git log, Argo state, workloads, events, commands, and summary even on failure;
- deletes the ephemeral cluster in an `always()` step.

The drill never pushes an image or commit to the repository and never contacts production. A live
staging rollback uses the same reviewed Git change; future in-cluster notification or a trusted
self-hosted runner may invoke it automatically without exposing the local cluster to GitHub-hosted
runners.
