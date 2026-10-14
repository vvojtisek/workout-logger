"""Production invariants of the Compose deployment (deploy/aws/compose.yaml).

These carry over the safety checks that previously guarded the Helm chart:
a single SQLite writer, readiness-based health, a hardened container, and
enough stop time for uvicorn's graceful shutdown.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "deploy" / "aws" / "compose.yaml"
E2E_OVERLAY = ROOT / "e2e" / "compose.e2e.yaml"
ENTRYPOINT = ROOT / "scripts" / "entrypoint.sh"


def compose() -> dict:
    return yaml.safe_load(COMPOSE.read_text())


def service() -> dict:
    return compose()["services"]["workout-logger"]


def duration_seconds(value: str) -> int:
    match = re.fullmatch(r"(?:(\d+)m)?(?:(\d+)s)?", value)
    assert match and any(match.groups()), value
    minutes, seconds = (int(part or 0) for part in match.groups())
    return minutes * 60 + seconds


def test_sqlite_has_exactly_one_writer_container() -> None:
    assert list(compose()["services"]) == ["workout-logger"]
    svc = service()
    assert "scale" not in svc
    assert svc.get("deploy", {}).get("replicas", 1) == 1
    assert svc["environment"]["DATABASE_URL"] == "sqlite+aiosqlite:////data/workout_logger.db"
    assert "./data:/data" in svc["volumes"]


def test_healthcheck_uses_database_readiness() -> None:
    test = " ".join(service()["healthcheck"]["test"])
    assert "/health/ready" in test


def test_container_is_hardened_and_bounded() -> None:
    svc = service()
    assert svc["read_only"] is True
    assert svc["cap_drop"] == ["ALL"]
    assert "no-new-privileges:true" in svc["security_opt"]
    assert svc["mem_limit"]
    assert svc["pids_limit"]
    assert "ports" not in svc


def test_stop_grace_period_exceeds_uvicorn_graceful_shutdown() -> None:
    match = re.search(r"--timeout-graceful-shutdown (\d+)", ENTRYPOINT.read_text())
    assert match
    uvicorn_timeout = int(match.group(1))

    assert duration_seconds(service()["stop_grace_period"]) > uvicorn_timeout


def test_e2e_overlay_only_publishes_loopback_port() -> None:
    overlay = yaml.safe_load(E2E_OVERLAY.read_text())
    assert overlay["services"]["workout-logger"]["ports"] == ["127.0.0.1:18000:8000"]


def test_container_applies_migrations_on_startup() -> None:
    # The deploy script takes a verified SQLite backup before starting a new
    # image, then the entrypoint migrates; no separate migration job exists.
    assert service()["environment"]["RUN_MIGRATIONS_ON_STARTUP"] == "true"
    assert "alembic upgrade head" in ENTRYPOINT.read_text()
