#!/usr/bin/env sh
set -eu

echo "[entrypoint] 1/4 validating configuration..."
python -c "from app.config import get_settings; get_settings()"

echo "[entrypoint] 2/4 verifying /data is writable..."
touch /data/.write_test
rm -f /data/.write_test

case "${RUN_MIGRATIONS_ON_STARTUP:-true}" in
  true)
    echo "[entrypoint] 3/4 running database migrations..."
    alembic upgrade head
    ;;
  false)
    echo "[entrypoint] 3/4 Skipping database migrations; managed by release job."
    ;;
  *)
    echo "[entrypoint] RUN_MIGRATIONS_ON_STARTUP must be 'true' or 'false'." >&2
    exit 1
    ;;
esac

echo "[entrypoint] 4/4 starting uvicorn..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --timeout-graceful-shutdown 50 \
  --proxy-headers
