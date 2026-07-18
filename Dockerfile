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

RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid appuser --shell /bin/sh --create-home appuser

WORKDIR /app

COPY pyproject.toml ./
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY scripts/entrypoint.sh scripts/backup_database.py ./scripts/

COPY --from=css-build /build/app/static/styles.css ./app/static/styles.css

RUN pip install --no-cache-dir . \
    && chmod +x scripts/entrypoint.sh \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data

VOLUME ["/data"]
EXPOSE 8000

USER appuser

ENTRYPOINT ["scripts/entrypoint.sh"]
