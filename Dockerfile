# syntax=docker/dockerfile:1

# ---- Stage 1: Tailwind CSS build ----
FROM node:slim AS css-build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci
COPY tailwind.config.js ./
COPY frontend/ ./frontend/
COPY app/static/index.html app/static/index.html
COPY app/static/app.js app/static/app.js
RUN npx tailwindcss -i ./frontend/input.css -o ./app/static/styles.css --minify

# ---- Stage 2: Python runtime ----
FROM python:3.11-slim AS runtime

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --shell /bin/false --no-create-home appuser

WORKDIR /app

COPY pyproject.toml ./
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY scripts/entrypoint.sh scripts/backup_database.py scripts/restore_database.py scripts/run_migrations.py scripts/validate_backup.py ./scripts/

COPY --from=css-build /build/app/static/styles.css ./app/static/styles.css

RUN pip install --no-cache-dir . \
    && python -m pip uninstall --yes pip setuptools wheel \
    && chmod +x scripts/entrypoint.sh \
    && mkdir -p /data \
    && chown -R 10001:10001 /app /data

VOLUME ["/data"]
EXPOSE 8000

USER 10001:10001

ENTRYPOINT ["scripts/entrypoint.sh"]
