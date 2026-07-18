import os
import tempfile

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy import inspect

from app.config import get_settings
from app.models import Base

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def alembic_db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.remove(path)
    yield path
    for suffix in ("", "-wal", "-shm"):
        candidate = path + suffix
        if os.path.exists(candidate):
            os.remove(candidate)


@pytest.fixture
def alembic_config(alembic_db_path):
    config = Config(os.path.join(REPO_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(REPO_ROOT, "alembic"))
    os.environ["API_KEY"] = "test-api-key-with-at-least-32-characters"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{alembic_db_path}"
    get_settings.cache_clear()
    yield config
    get_settings.cache_clear()


def test_alembic_upgrade_head_creates_all_tables(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    tables = set(inspector.get_table_names())

    expected = {"workout_plans", "plan_exercises", "workout_logs", "exercise_logs"}
    assert expected.issubset(tables)
    sync_engine.dispose()


def test_alembic_schema_matches_models_exactly(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.connect() as connection:
        migration_context = MigrationContext.configure(connection)
        diff = compare_metadata(migration_context, Base.metadata)

    assert diff == [], f"Schema drift between Alembic migrations and models: {diff}"
    sync_engine.dispose()


def test_alembic_downgrade_removes_all_tables(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, "base")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    tables = set(inspector.get_table_names())

    for table_name in ("workout_plans", "plan_exercises", "workout_logs", "exercise_logs"):
        assert table_name not in tables
    sync_engine.dispose()
