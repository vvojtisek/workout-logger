# SQLite backup and restore runbook

The application has exactly one SQLite writer: the `workout-logger` Compose service on the
production host. An online backup is safe while that writer runs; replacing the database file
is not. `backup_database.py` therefore uses SQLite's online backup API, while
`restore_database.py` requires an explicit exclusive-access confirmation and replaces the
database atomically only after validating the artifact.

All commands below run as root on the host. They use the same Compose invocation as the deploy
script:

```bash
cd /srv/workout-logger
compose=(docker compose --project-name workout-logger
  --env-file .env.release --env-file .env.production -f compose.yaml)
```

## Backup artifacts and retention

* `workout-logger-backup.timer` runs `/usr/local/sbin/backup-workout-logger` daily at about
  02:30 UTC and keeps the 14 newest backups in `/srv/workout-logger/backups`.
* `deploy-workout-logger.sh` also takes a backup with the *previous* image before starting a
  new release.
* Every `<name>.db` has a `<name>.json` sidecar with the UTC timestamp, source release, image
  reference, SHA-256, size and Alembic revision. Creation fails unless the checksum and
  `PRAGMA integrity_check` pass.

Backups are on the same disk as the database. Until off-site replication exists, copy them off
the instance periodically.

```bash
systemctl list-timers workout-logger-backup.timer
journalctl -u workout-logger-backup.service -n 20
ls -l /srv/workout-logger/backups
```

Take an ad-hoc backup:

```bash
/usr/local/sbin/backup-workout-logger
```

## Restore

Restoring replaces every change made after the backup was taken. The app is unavailable from
step 2 until step 4.

### 1. Select and verify the backup

```bash
ls -l /srv/workout-logger/backups/*.db
backup=workout_logger-<timestamp>.db
"${compose[@]}" run --rm --no-deps --entrypoint python workout-logger \
  scripts/validate_backup.py "/backups/$backup"
```

Check that the `.json` sidecar's `alembic_revision` is not newer than the code of the release
you will start in step 4.

### 2. Take a diagnostic backup, then stop the writer

```bash
/usr/local/sbin/backup-workout-logger
"${compose[@]}" stop workout-logger
"${compose[@]}" ps --all   # workout-logger must show "Exited"
```

### 3. Restore

```bash
"${compose[@]}" run --rm --no-deps --entrypoint python workout-logger \
  scripts/restore_database.py --backup "/backups/$backup" --confirm-exclusive-access
```

The script validates the artifact again, writes it beside the live file and atomically renames
it into place.

### 4. Start and verify

```bash
"${compose[@]}" up --detach --pull never --wait --wait-timeout 300
curl -fsS https://fitness.vvojtisek.eu/health/ready
```

On startup the entrypoint applies any newer migrations to the restored database.

### Abort

If step 3 fails, the live database file has not been replaced. Start the app again with step 4
and investigate using the diagnostic backup from step 2.
