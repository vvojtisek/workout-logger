"""The entrypoint must not crash-loop when an older release starts on a newer schema.

Rolling back to a previous image keeps the database at the newer revision, and
`alembic upgrade head` on that image fails with "Can't locate revision".
"""

from __future__ import annotations

import os
import sqlite3
import tempfile

import pytest
from alembic.config import Config

from alembic import command
from app.config import get_settings
from app.schema_guard import NEWER_SCHEMA, UPGRADE, check

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.remove(path)
    os.environ["API_KEY"] = "test-api-key-with-at-least-32-characters"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{path}"
    get_settings.cache_clear()
    yield path
    get_settings.cache_clear()
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)


def upgrade_to_head() -> None:
    config = Config(os.path.join(REPO_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(REPO_ROOT, "alembic"))
    command.upgrade(config, "head")


def test_an_empty_database_is_upgraded(db_path):
    assert check() == UPGRADE


def test_a_database_this_release_knows_is_upgraded(db_path):
    upgrade_to_head()
    assert check() == UPGRADE


def test_a_database_from_a_newer_release_is_left_alone(db_path):
    upgrade_to_head()
    with sqlite3.connect(db_path) as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'ffffffffffff'")

    assert check() == NEWER_SCHEMA
