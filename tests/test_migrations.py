import os
import shutil
import tempfile
import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy import inspect, text

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


def test_active_session_migration_upgrades_a_copy_of_current_schema(
    alembic_config, alembic_db_path, tmp_path
):
    command.upgrade(alembic_config, "93469c1ebbbf")
    original_plan_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, :name, :description, :created_at, :updated_at)"
            ),
            {
                "id": original_plan_id,
                "name": "Existing current-schema plan",
                "description": "must survive",
                "created_at": "2026-08-20 10:00:00",
                "updated_at": "2026-08-20 10:00:00",
            },
        )
    sync_engine.dispose()

    copied_path = tmp_path / "current-schema-copy.db"
    shutil.copy2(alembic_db_path, copied_path)
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{copied_path}"
    get_settings.cache_clear()

    command.upgrade(alembic_config, "head")

    copied_engine = create_sync_engine(f"sqlite:///{copied_path}")
    inspector = inspect(copied_engine)
    assert {
        "workout_sessions",
        "session_exercises",
        "set_entries",
    }.issubset(set(inspector.get_table_names()))
    with copied_engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT name FROM workout_plans WHERE id = :id"), {"id": original_plan_id}
            )
            == "Existing current-schema plan"
        )
    copied_engine.dispose()


def test_grid_group_migration_preserves_slice_one_data(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "3d62adf731c8")
    plan_id = str(uuid.uuid4())
    exercise_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, 'Slice 1 plan', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id},
        )
        connection.execute(
            text(
                "INSERT INTO plan_exercises "
                "(id, workout_plan_id, sort_order, exercise_name, target_sets, "
                "target_reps_min, target_reps_max, target_weight_kg, rest_time_seconds, notes) "
                "VALUES (:id, :plan_id, 0, 'Squat', 2, 5, 8, 80, 90, NULL)"
            ),
            {"id": exercise_id, "plan_id": plan_id},
        )
    command.upgrade(alembic_config, "head")

    inspector = inspect(sync_engine)
    for table_name in ("plan_exercises", "session_exercises"):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert {"group_key", "group_order"}.issubset(columns)
    with sync_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT exercise_name, group_key, group_order FROM plan_exercises WHERE id = :id"
            ),
            {"id": exercise_id},
        ).one()
        assert row == ("Squat", None, None)
    sync_engine.dispose()
