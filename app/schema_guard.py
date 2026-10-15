"""Decides whether the entrypoint should run `alembic upgrade head`.

After a rollback the database can carry a revision from a newer release that
this image does not know; `alembic upgrade head` then fails and the container
would crash-loop. Migrations are kept backward-compatible with the previous
release, so the older image can run on the newer schema: skip the upgrade.

Exit codes: 0 = upgrade, 10 = newer schema (skip), anything else = error.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.database import create_engine

UPGRADE = 0
NEWER_SCHEMA = 10

_ROOT = Path(__file__).resolve().parents[1]


async def _current_revisions() -> list[str]:
    engine = create_engine()
    try:
        async with engine.connect() as connection:
            try:
                result = await connection.execute(text("SELECT version_num FROM alembic_version"))
            except OperationalError:
                return []  # A fresh database has no alembic_version table yet.
            return list(result.scalars().all())
    finally:
        await engine.dispose()


def _known(script: ScriptDirectory, revision: str) -> bool:
    try:
        return script.get_revision(revision) is not None
    except CommandError:
        return False


def check() -> int:
    config = Config(str(_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)
    unknown = [rev for rev in asyncio.run(_current_revisions()) if not _known(script, rev)]
    if unknown:
        print(
            f"[schema-guard] database is at {', '.join(unknown)}, newer than this release; "
            "skipping migrations",
            file=sys.stderr,
        )
        return NEWER_SCHEMA
    return UPGRADE


if __name__ == "__main__":
    raise SystemExit(check())
