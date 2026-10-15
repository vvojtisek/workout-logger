#!/usr/bin/env bash
set -Eeuo pipefail

verify_release_checksums() {
  local checksum_file="$1"
  shift
  local selected_checksums="${checksum_file}.selected"
  : > "$selected_checksums"

  local asset
  for asset in "$@"; do
    grep -F "  ./$asset" "$checksum_file" >> "$selected_checksums"
  done

  (
    cd "$(dirname "$checksum_file")"
    sha256sum --check --strict "$(basename "$selected_checksums")"
  )
}

release_tag="${1:?Usage: deploy-aws-release.sh vX.Y.Z}"
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release tag: $release_tag" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64|amd64) image_arch="amd64" ;;
  aarch64|arm64) image_arch="arm64" ;;
  *) echo "Unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
esac

app_dir="${WORKOUT_LOGGER_DIR:-/srv/workout-logger}"
chem_app_dir="${CHEM_APP_DIR:-/srv/chem-app}"
docker_network="${CHEM_APP_DOCKER_NETWORK:-chem-app_public-net}"
repository="${GITHUB_REPOSITORY:-vvojtisek/workout-logger}"
asset_base="https://github.com/${repository}/releases/download/${release_tag}"
image_archive="workout-logger-${release_tag}-linux-${image_arch}-image.tar.gz"
compose_asset="workout-logger-${release_tag}-compose.yaml"
checksum_asset="workout-logger-${release_tag}-SHA256SUMS"
image="ghcr.io/vvojtisek/workout-logger:${release_tag}"
release_assets=(
  "$image_archive"
  "$compose_asset"
  "workout-logger-${release_tag}-env.example"
  "workout-logger-${release_tag}-caddy-snippet.txt"
  "deploy-workout-logger.sh"
  "backup-workout-logger.sh"
  "workout-logger-backup.service"
  "workout-logger-backup.timer"
)

for command in docker curl sha256sum grep sed install systemctl uname; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
docker compose version >/dev/null

install -d -m 755 "$app_dir"
if [[ ! -s "$app_dir/.env.production" ]]; then
  echo "Missing $app_dir/.env.production; install the production secret file first." >&2
  exit 1
fi
chmod 600 "$app_dir/.env.production"
grep -Eq '^API_KEY=.{32,}$' "$app_dir/.env.production" || {
  echo "The production file must contain an API_KEY of at least 32 characters." >&2
  exit 1
}

caddyfile="$chem_app_dir/deploy/aws/Caddyfile"
if [[ ! -f "$caddyfile" ]] || ! grep -Fq 'fitness.vvojtisek.eu' "$caddyfile"; then
  echo "Configure the fitness.vvojtisek.eu Caddy site in $caddyfile before deploying." >&2
  exit 1
fi
docker network inspect "$docker_network" >/dev/null || {
  echo "Required shared Docker network does not exist: $docker_network" >&2
  exit 1
}

install -d -m 750 -o 10001 -g 10001 "$app_dir/data"
install -d -m 750 -o 10001 -g 10001 "$app_dir/backups"
temporary_dir="$(mktemp -d)"
cleanup() { rm -rf "$temporary_dir"; }
trap cleanup EXIT

curl --fail --location --silent --show-error \
  "$asset_base/$checksum_asset" -o "$temporary_dir/$checksum_asset"
for asset in "${release_assets[@]}"; do
  curl --fail --location --silent --show-error \
    "$asset_base/$asset" -o "$temporary_dir/$asset"
done
verify_release_checksums "$temporary_dir/$checksum_asset" "${release_assets[@]}"
docker load --input "$temporary_dir/$image_archive"
install -m 640 "$temporary_dir/$compose_asset" "$app_dir/compose.yaml.new"
install -m 640 "$temporary_dir/workout-logger-${release_tag}-env.example" \
  "$app_dir/.env.production.example"
install -m 640 "$temporary_dir/workout-logger-${release_tag}-caddy-snippet.txt" \
  "$app_dir/chem-app-Caddyfile.snippet"
install -m 755 "$temporary_dir/backup-workout-logger.sh" \
  /usr/local/sbin/backup-workout-logger
install -m 644 "$temporary_dir/workout-logger-backup.service" \
  /etc/systemd/system/workout-logger-backup.service
install -m 644 "$temporary_dir/workout-logger-backup.timer" \
  /etc/systemd/system/workout-logger-backup.timer
systemctl daemon-reload
systemctl enable --now workout-logger-backup.timer

mv "$app_dir/compose.yaml.new" "$app_dir/compose.yaml"

release_file="$app_dir/.env.release"
previous_file="$app_dir/.env.release.previous"
had_previous=false
if [[ -s "$release_file" ]]; then
  install -m 600 "$release_file" "$previous_file"
  had_previous=true
  previous_tag="$(sed -n 's/^RELEASE_TAG=//p' "$previous_file")"
  previous_image="ghcr.io/vvojtisek/workout-logger:${previous_tag}"

  if [[ -f "$app_dir/data/workout_logger.db" ]]; then
    docker compose --project-name workout-logger \
      --env-file "$previous_file" --env-file "$app_dir/.env.production" \
      -f "$app_dir/compose.yaml" \
      run --rm --no-deps --entrypoint python workout-logger \
      scripts/backup_database.py \
      --source-release "$previous_tag" \
      --source-image "$previous_image" \
      --dest-dir /backups
  fi
fi

printf 'RELEASE_TAG=%s\nCHEM_APP_DOCKER_NETWORK=%s\n' \
  "$release_tag" "$docker_network" > "$app_dir/.env.release.new"
chmod 600 "$app_dir/.env.release.new"
mv "$app_dir/.env.release.new" "$release_file"

compose=(docker compose --project-name workout-logger \
  --env-file "$release_file" --env-file "$app_dir/.env.production" \
  -f "$app_dir/compose.yaml")
if "${compose[@]}" config --quiet && \
  "${compose[@]}" up -d --pull never --force-recreate --wait --wait-timeout 300; then
  echo "Deployed $image and passed the container readiness check."
  exit 0
fi

echo "Release $release_tag failed readiness; attempting image rollback." >&2
if [[ "$had_previous" == true ]]; then
  install -m 600 "$previous_file" "$release_file"
  "${compose[@]}" up -d --pull never --force-recreate --wait --wait-timeout 300 || {
    echo "Automatic image rollback also failed; inspect the app logs and verified backup." >&2
    exit 1
  }
  echo "Restored application image $previous_image; the database was left at its migrated schema." >&2
else
  "${compose[@]}" down || true
  rm -f "$release_file"
  echo "Initial deployment failed; no previous image was available to restore." >&2
fi
exit 1
