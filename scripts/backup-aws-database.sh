#!/usr/bin/env bash
set -Eeuo pipefail

app_dir="${WORKOUT_LOGGER_DIR:-/srv/workout-logger}"
release_file="$app_dir/.env.release"
release_tag="$(sed -n 's/^RELEASE_TAG=//p' "$release_file")"
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Missing or invalid RELEASE_TAG in $release_file" >&2
  exit 2
fi

image="ghcr.io/vvojtisek/workout-logger:${release_tag}"
docker compose --project-name workout-logger \
  --env-file "$release_file" --env-file "$app_dir/.env.production" \
  -f "$app_dir/compose.yaml" \
  run --rm --no-deps --entrypoint python workout-logger \
  scripts/backup_database.py \
  --source-release "$release_tag" \
  --source-image "$image" \
  --dest-dir /backups \
  --keep 14
