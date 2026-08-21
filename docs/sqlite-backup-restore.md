# SQLite backup and restore runbook

The application currently has one SQLite writer. Online backup is safe while that writer is
active; database-file replacement is not. `backup_database.py` therefore uses SQLite's online
backup API, while `restore_database.py` requires exclusive-access confirmation and replaces the
database atomically only after validating the artifact.

## Backup artifacts and retention

Enable scheduled backups in the environment values only after the deployed immutable image
contains the backup scripts:

```yaml
backupPersistence:
  enabled: true
  size: 5Gi

backup:
  enabled: true
  schedule: "17 2 * * *"
  keep: 7
```

The chart creates `<release>-backups`, a PVC distinct from `<release>-data`. Both Argo CD prune
and Helm deletion are disabled for the managed backup claim. An externally managed claim can
instead be selected with `backupPersistence.existingClaim`. A second PVC protects backups from
application-PVC replacement; storage snapshots or an off-cluster export are still required for
cluster- or storage-class-wide disaster recovery.

The CronJob uses `concurrencyPolicy: Forbid` and the same immutable image as the release. It
writes pairs such as:

```text
workout_logger-20260821T120000123456Z.db
workout_logger-20260821T120000123456Z.json
```

The JSON records `created_at`, `source_release`, `source_image`, `sha256`, `size_bytes`, and
`schema_revision`. A new pair is published only after SQLite returns `ok` from
`PRAGMA integrity_check`; retention removes old database/metadata pairs together. Confirm the
latest scheduled run and retain its logs:

```bash
kubectl get cronjob,job -n prod -l app.kubernetes.io/name=workout-logger
kubectl logs -n prod job/<backup-job-name>
```

The success line names the verified artifact. A validation container with the backup PVC mounted
read-only can independently check it with:

```bash
python /app/scripts/validate_backup.py /backups/<backup-file>.db
```

The command exits nonzero for missing metadata, checksum/size mismatch, SQLite corruption, or a
schema-revision mismatch. Never edit either member of an artifact pair.

## Isolated restore drill

Run this drill in an ephemeral namespace/application, using a real file-backed database and API.
Do not point it at production PVCs.

1. Set `TEST_RUN_ID=backup-restore-<UTC timestamp>` and create representative plans, exercises,
   and logs through the real API with that value embedded in their names or notes.
2. Enable the backup CronJob on a short test schedule, wait for a successful Job, and record the
   `.db` filename and JSON metadata from its logs/backup PVC.
3. Read the tagged records back through the API. Then mutate or delete them so restoration can be
   distinguished from the current database state.
4. Apply a declarative maintenance configuration with `replicaCount: 0`,
   `migrationJob.enabled: false`, `backup.suspend: true`, `restore.enabled: true`, and the selected
   `restore.backupFile`. Wait until no web Pod exists before the PostSync restore Job starts.
5. Require the restore Job to complete successfully and retain its log. A deliberately damaged
   copy must make `validate_backup.py` exit nonzero before testing the valid artifact.
6. Apply the recovery configuration: disable restore, re-enable migrations and backups, and set
   `replicaCount: 1`. Wait for migration, startup, readiness, and liveness checks.
7. Read every tagged record through the real API and compare its persisted fields with the values
   recorded before backup.
8. Delete all tagged API records, verify they return `404` or are absent from list results, then
   delete the ephemeral Application/namespace and both disposable PVCs.

Record the test run ID, image digest, source commit, backup filename/checksum/revision, Job logs,
health results, recovered values, and verified cleanup in the acceptance report.

## Production restore maintenance window

Restoration is intentionally a two-change GitOps procedure. Expected downtime begins when Argo CD
scales the Deployment to zero and ends only after the recovery change is healthy and the API smoke
test passes. Announce and accept that window before merging the maintenance change.

### 1. Select and verify

- Confirm the selected artifact is on the dedicated backup PVC and its scheduled Job succeeded.
- Compare `source_image` with a known release, verify its SHA-256 and `PRAGMA integrity_check`, and
  record the artifact's `schema_revision`.
- Decide whether that revision equals the target image's Alembic head. If it is older, the recovery
  change must run the normal migration Job. Never downgrade a newer, incompatible backup in place.
- Confirm no backup Job is active and arrange to suspend the CronJob in the maintenance change.

### 2. Scale down and restore

Open and review a Git change to the production values:

```yaml
replicaCount: 0

migrationJob:
  enabled: false

backup:
  enabled: true
  suspend: true

restore:
  enabled: true
  backupFile: workout_logger-<timestamp>.db
```

Merge it and let Argo CD reconcile. Do not use `kubectl scale`, `kubectl cp`, `rm` against the data
PVC, `helm upgrade`, or `helm rollback`. Verify the Deployment has zero available replicas and no
web Pod before accepting the PostSync restore Job. The Job mounts the backup PVC read-only,
validates metadata/checksum/integrity, copies through SQLite into a temporary file on the data PVC,
removes stale WAL/SHM files under exclusive access, and atomically replaces the database.

```bash
kubectl get deployment,pod,job -n prod -l app.kubernetes.io/name=workout-logger
kubectl logs -n prod job/<restore-job-name>
```

Do not proceed unless the restore log ends with `Verified backup restored` and the Argo operation
is successful. Keep the application scaled down after restore while the recovery change is reviewed.

### 3. Migrate, scale up, and validate

Open a second Git change that sets `restore.enabled: false`, `migrationJob.enabled: true`,
`backup.suspend: false`, and `replicaCount: 1`. Enabling the normal PreSync migration Job is the
default safe decision for an older compatible schema: it runs while the previous desired state
still has zero web replicas, and a migration failure blocks scale-up. For an incompatible newer
schema, stop and build a compatible recovery image instead.

After Argo CD reports Synced and Healthy, verify:

```bash
kubectl get deployment,pod,job -n prod -l app.kubernetes.io/name=workout-logger
kubectl logs -n prod job/<migration-job-name>
kubectl get endpoints workout-logger -n prod
curl --fail https://fitness.vvojtisek.eu/health/startup
curl --fail https://fitness.vvojtisek.eu/health/live
curl --fail https://fitness.vvojtisek.eu/health/ready
```

Confirm the running image ID matches the reviewed digest, then perform read-only API checks for
known records. Production writes require the repository's separate explicit authorization.

### Abort

If artifact validation, restore, migration, or health checks fail, do not scale the application up
and do not delete the failed Job or evidence. Keep the Deployment at zero, preserve logs and both
PVCs, and diagnose the failure. Select another already verified backup by reviewing a new
maintenance commit, or prepare a compatible recovery image. Reverting directly to the live state
after a partial restore is unsafe; recovery completes only through a reviewed Git change and a
successful health/data check.
