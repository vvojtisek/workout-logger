#!/usr/bin/env sh
set -eu

echo "[entrypoint] 1/4 validating configuration..."
python -c "from app.config import get_settings; get_settings()"

echo "[entrypoint] 2/4 verifying /data is writable..."
touch /data/.write_test
rm -f /data/.write_test

echo "[entrypoint] 3/4 running database migrations..."
alembic upgrade head

echo "[entrypoint] 4/4 starting uvicorn..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers
