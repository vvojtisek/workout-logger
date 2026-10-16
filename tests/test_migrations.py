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
from sqlalchemy.exc import IntegrityError

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


def test_workout_plan_owner_migration_preserves_existing_unowned_plans(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "d4e8f1a6c7b3")
    test_run_id = uuid.uuid4().hex
    plan_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, :name, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id, "name": f"Legacy ownerless plan {test_run_id}"},
        )

    command.upgrade(alembic_config, "head")

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT name, owner_id FROM workout_plans WHERE id = :id"), {"id": plan_id}
        ).one()
    assert row == (f"Legacy ownerless plan {test_run_id}", None)
    sync_engine.dispose()


def test_workout_plan_owner_migration_assigns_legacy_rows_to_existing_admin(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "fce0c499942e")
    test_run_id = uuid.uuid4().hex
    admin_id = str(uuid.uuid4())
    plan_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, password_hash, role, disabled_at, created_at, updated_at) "
                "VALUES (:id, :email, 'not-a-real-password-hash', 'admin', NULL, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": admin_id, "email": f"admin-{test_run_id}@example.test"},
        )
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, :name, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id, "name": f"Legacy admin plan {test_run_id}"},
        )

    command.upgrade(alembic_config, "head")

    with sync_engine.connect() as connection:
        owner_id = connection.scalar(
            text("SELECT owner_id FROM workout_plans WHERE id = :id"), {"id": plan_id}
        )
    assert owner_id == admin_id
    sync_engine.dispose()


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
            text("SELECT exercise_name, group_key, group_order FROM plan_exercises WHERE id = :id"),
            {"id": exercise_id},
        ).one()
        assert row == ("Squat", None, None)
    sync_engine.dispose()


def test_exercise_kind_migration_backfills_existing_rows_as_strength(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "8e2f78cce104")
    plan_id = str(uuid.uuid4())
    exercise_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, 'Pre-kind plan', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id},
        )
        connection.execute(
            text(
                "INSERT INTO plan_exercises "
                "(id, workout_plan_id, sort_order, exercise_name, target_sets, "
                "target_reps_min, target_reps_max, target_weight_kg, rest_time_seconds, notes) "
                "VALUES (:id, :plan_id, 0, 'Bench Press', 3, 5, 8, 60, 90, NULL)"
            ),
            {"id": exercise_id, "plan_id": plan_id},
        )
    command.upgrade(alembic_config, "head")

    inspector = inspect(sync_engine)
    for table_name in ("plan_exercises", "session_exercises"):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert "exercise_kind" in columns
    set_entry_columns = {column["name"] for column in inspector.get_columns("set_entries")}
    assert {
        "added_weight_kg",
        "band_level",
        "duration_seconds",
        "distance_km",
        "incline_percent",
        "rpe",
    }.issubset(set_entry_columns)
    with sync_engine.connect() as connection:
        kind = connection.scalar(
            text("SELECT exercise_kind FROM plan_exercises WHERE id = :id"), {"id": exercise_id}
        )
        assert kind == "strength"
    sync_engine.dispose()


def test_exercise_catalogue_migration_adds_table_and_nullable_link(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "844b72e266c6")
    plan_id = str(uuid.uuid4())
    plan_exercise_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, 'Pre-catalogue plan', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id},
        )
        connection.execute(
            text(
                "INSERT INTO plan_exercises "
                "(id, workout_plan_id, sort_order, exercise_name, exercise_kind, target_sets, "
                "target_reps_min, target_reps_max, target_weight_kg, rest_time_seconds, notes) "
                "VALUES (:id, :plan_id, 0, 'Bench Press', 'strength', 3, 5, 8, 60, 90, NULL)"
            ),
            {"id": plan_exercise_id, "plan_id": plan_id},
        )
    command.upgrade(alembic_config, "head")

    inspector = inspect(sync_engine)
    assert "exercises" in inspector.get_table_names()
    plan_exercise_columns = {column["name"] for column in inspector.get_columns("plan_exercises")}
    assert "catalog_exercise_id" in plan_exercise_columns

    exercise_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys = ON"))
        connection.execute(
            text(
                "INSERT INTO exercises "
                "(id, name, aliases, media_url, primary_muscles, secondary_muscles, "
                "instructions, equipment, safety_notes, created_at, updated_at) "
                "VALUES (:id, 'Bench Press', '[]', NULL, '[]', '[]', '[]', NULL, NULL, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": exercise_id},
        )
        connection.execute(
            text("UPDATE plan_exercises SET catalog_exercise_id = :exercise_id WHERE id = :id"),
            {"exercise_id": exercise_id, "id": plan_exercise_id},
        )
        connection.execute(text("DELETE FROM exercises WHERE id = :id"), {"id": exercise_id})

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT exercise_name, catalog_exercise_id FROM plan_exercises WHERE id = :id"),
            {"id": plan_exercise_id},
        ).one()
        assert row == ("Bench Press", None)
    sync_engine.dispose()


def test_programs_migration_adds_tables_with_no_overlap_constraint(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "f4c82c310a12")
    plan_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO workout_plans "
                "(id, name, description, created_at, updated_at) "
                "VALUES (:id, 'Pre-programs plan', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": plan_id},
        )
    command.upgrade(alembic_config, "head")

    inspector = inspect(sync_engine)
    assert {"programs", "scheduled_workouts"}.issubset(set(inspector.get_table_names()))

    program_one = str(uuid.uuid4())
    program_two = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys = ON"))
        for program_id, name in [(program_one, "Hockey Pre-Season"), (program_two, "Hypertrophy")]:
            connection.execute(
                text(
                    "INSERT INTO programs "
                    "(id, owner_id, name, kind, start_date, end_date, status, notes, "
                    "created_at, updated_at) "
                    "VALUES (:id, NULL, :name, 'block', '2026-01-01', '2026-03-01', 'active', "
                    "NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": program_id, "name": name},
            )
        # Two overlapping programs both scheduling a workout on the same day:
        # no unique constraint blocks this by design.
        for program_id in (program_one, program_two):
            connection.execute(
                text(
                    "INSERT INTO scheduled_workouts "
                    "(id, owner_id, program_id, workout_plan_id, scheduled_date, status, "
                    "workout_session_id, created_at, updated_at) "
                    "VALUES (:id, NULL, :program_id, :plan_id, '2026-01-05', 'scheduled', "
                    "NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": str(uuid.uuid4()), "program_id": program_id, "plan_id": plan_id},
            )

    with sync_engine.connect() as connection:
        count = connection.scalar(
            text("SELECT COUNT(*) FROM scheduled_workouts WHERE scheduled_date = '2026-01-05'")
        )
        assert count == 2
    sync_engine.dispose()


def test_body_metrics_migration_adds_table(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "81f5b00da187")
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    assert "body_metrics" in inspector.get_table_names()

    metric_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO body_metrics "
                "(id, owner_id, measured_at, weight_kg, body_fat_percent, neck_cm, chest_cm, "
                "waist_cm, hips_cm, biceps_cm, forearms_cm, thighs_cm, calves_cm, "
                "created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-15 08:00:00', 78.2, 18.5, NULL, NULL, 85, NULL, "
                "NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": metric_id},
        )

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT weight_kg, waist_cm FROM body_metrics WHERE id = :id"), {"id": metric_id}
        ).one()
        assert row == (78.2, 85.0)
    sync_engine.dispose()


def test_nutrition_core_migration_adds_tables_and_preserves_snapshot_on_food_delete(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "4e263e1811d8")
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    assert {"foods", "nutrition_plans", "meal_entries", "meal_items"}.issubset(
        set(inspector.get_table_names())
    )

    food_id = str(uuid.uuid4())
    entry_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys = ON"))
        connection.execute(
            text(
                "INSERT INTO foods "
                "(id, owner_id, name, brand, serving_quantity, serving_unit, energy_kcal, "
                "protein_g, carbohydrate_g, fat_g, fiber_g, source, created_at, updated_at) "
                "VALUES (:id, NULL, 'Chicken Breast', NULL, 100, 'g', 165, 31, 0, 3.6, 0, "
                "'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": food_id},
        )
        connection.execute(
            text(
                "INSERT INTO meal_entries "
                "(id, owner_id, consumed_at, meal_type, notes, created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-15 08:00:00', 'breakfast', NULL, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": entry_id},
        )
        connection.execute(
            text(
                "INSERT INTO meal_items "
                "(id, meal_entry_id, food_id, food_name_snapshot, quantity, unit, "
                "energy_kcal_snapshot, protein_g_snapshot, carbohydrate_g_snapshot, "
                "fat_g_snapshot, fiber_g_snapshot) "
                "VALUES (:id, :entry_id, :food_id, 'Chicken Breast', 150, 'g', "
                "247.5, 46.5, 0, 5.4, 0)"
            ),
            {"id": item_id, "entry_id": entry_id, "food_id": food_id},
        )
        connection.execute(text("DELETE FROM foods WHERE id = :id"), {"id": food_id})

    with sync_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT food_id, food_name_snapshot, energy_kcal_snapshot FROM meal_items WHERE id = :id"
            ),
            {"id": item_id},
        ).one()
        assert row == (None, "Chicken Breast", 247.5)
    sync_engine.dispose()


def test_sleep_entries_migration_adds_table_with_computed_duration(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "6290bdbe0ab7")
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    assert "sleep_entries" in inspector.get_table_names()

    entry_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO sleep_entries "
                "(id, owner_id, sleep_start, sleep_end, timezone, time_in_bed_seconds, "
                "estimated_sleep_seconds, awake_seconds, quality_score, resting_heart_rate, "
                "notes, source, created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-16 04:00:00', '2026-01-16 12:00:00', "
                "'America/New_York', 28800, 25200, 600, 4, 58, NULL, 'manual', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": entry_id},
        )

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT time_in_bed_seconds, quality_score FROM sleep_entries WHERE id = :id"),
            {"id": entry_id},
        ).one()
        assert row == (28800, 4)
    sync_engine.dispose()


def test_api_tokens_migration_adds_table_with_unique_hash_index(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "4ce075343442")
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    assert "api_tokens" in inspector.get_table_names()
    indexes = inspector.get_indexes("api_tokens")
    hash_index = next(i for i in indexes if "token_hash" in i["column_names"])
    assert hash_index["unique"]

    token_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO api_tokens "
                "(id, owner_id, name, token_hash, token_prefix, scopes, last_used_at, "
                "revoked_at, created_at, updated_at) "
                "VALUES (:id, NULL, 'MCP agent', 'a' || :id, 'wl_abc12345', 'read,log', NULL, "
                "NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": token_id},
        )

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT name, scopes FROM api_tokens WHERE id = :id"), {"id": token_id}
        ).one()
        assert row == ("MCP agent", "read,log")
    sync_engine.dispose()


def test_health_ingest_migration_backfills_source_and_adds_step_counts(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "7a1f9c3e5b2d")
    metric_id = str(uuid.uuid4())
    log_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO body_metrics "
                "(id, owner_id, measured_at, weight_kg, created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-15 08:00:00', 78.2, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": metric_id},
        )
        connection.execute(
            text(
                "INSERT INTO workout_logs "
                "(id, performed_at, total_time_minutes, overall_feeling, "
                "created_at, updated_at) "
                "VALUES (:id, '2026-01-15 08:00:00', 45, 4, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": log_id},
        )
    command.upgrade(alembic_config, "head")

    inspector = inspect(sync_engine)
    assert "step_counts" in inspector.get_table_names()

    # Pre-existing rows backfill to the "manual" source with a NULL external_id.
    with sync_engine.connect() as connection:
        metric_row = connection.execute(
            text("SELECT source, external_id FROM body_metrics WHERE id = :id"), {"id": metric_id}
        ).one()
        assert metric_row == ("manual", None)
        log_row = connection.execute(
            text("SELECT source, external_id FROM workout_logs WHERE id = :id"), {"id": log_id}
        ).one()
        assert log_row == ("manual", None)

    # The unique (source, external_id) constraint makes a re-synced row idempotent...
    step_id_one = str(uuid.uuid4())
    step_id_two = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO step_counts "
                "(id, owner_id, recorded_date, steps, source, external_id, "
                "created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-15', 10432, 'health_connect', 'hc-1', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": step_id_one},
        )
    with sync_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT steps FROM step_counts WHERE id = :id"), {"id": step_id_one}
            ).one()[0]
            == 10432
        )

    # ...while a second manual body_metrics row (NULL external_id) is unaffected,
    # since SQL treats no two NULLs as equal for a unique constraint.
    second_manual_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO body_metrics "
                "(id, owner_id, measured_at, weight_kg, source, external_id, "
                "created_at, updated_at) "
                "VALUES (:id, NULL, '2026-01-16 08:00:00', 77.9, 'manual', NULL, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": second_manual_id},
        )

    with sync_engine.begin() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO step_counts "
                    "(id, owner_id, recorded_date, steps, source, external_id, "
                    "created_at, updated_at) "
                    "VALUES (:id, NULL, '2026-01-16', 1, 'health_connect', 'hc-1', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": step_id_two},
            )
    sync_engine.dispose()


def test_user_settings_migration_adds_table_with_defaults_enforced_by_check_constraints(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "b3f7a2c9e5d1")
    command.upgrade(alembic_config, "head")

    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    inspector = inspect(sync_engine)
    assert "user_settings" in inspector.get_table_names()

    settings_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO user_settings "
                "(id, owner_id, units, default_rest_compound_seconds, "
                "default_rest_isolation_seconds, created_at, updated_at) "
                "VALUES (:id, NULL, 'metric', 90, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": settings_id},
        )

    with sync_engine.connect() as connection:
        row = connection.execute(
            text("SELECT units, default_rest_compound_seconds FROM user_settings WHERE id = :id"),
            {"id": settings_id},
        ).one()
        assert row == ("metric", 90)

    with sync_engine.begin() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO user_settings "
                    "(id, owner_id, units, default_rest_compound_seconds, "
                    "default_rest_isolation_seconds, created_at, updated_at) "
                    "VALUES (:id, NULL, 'furlongs', 90, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": str(uuid.uuid4())},
            )
    sync_engine.dispose()


def test_metric_standardization_migration_normalizes_only_saved_unit_preferences(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "c2e4a6b8d0f1")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    settings_id = str(uuid.uuid4())
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO user_settings "
                "(id, owner_id, units, default_rest_compound_seconds, "
                "default_rest_isolation_seconds, created_at, updated_at) "
                "VALUES (:id, NULL, 'imperial', 90, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": settings_id},
        )

    command.upgrade(alembic_config, "head")
    with sync_engine.begin() as connection:
        row = connection.execute(
            text("SELECT units, default_rest_compound_seconds FROM user_settings WHERE id = :id"),
            {"id": settings_id},
        ).one()
    assert row == ("metric", 90)
    sync_engine.dispose()


def test_exercise_catalogue_seed_adds_shared_templates_and_keeps_existing(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "5c0aa5e4d191")
    existing_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO exercises (id, owner_id, name, aliases, primary_muscles, "
                "secondary_muscles, instructions, equipment, created_at, updated_at) "
                "VALUES (:id, NULL, 'goblet SQUAT', '[]', '[]', '[]', '[]', 'my own', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": existing_id},
        )

    command.upgrade(alembic_config, "a7c3e9d2b4f1")

    with sync_engine.connect() as connection:
        shared, owned = connection.execute(
            text("SELECT sum(owner_id IS NULL), sum(owner_id IS NOT NULL) FROM exercises")
        ).one()
        goblet = connection.execute(
            text("SELECT id, equipment FROM exercises WHERE lower(name) = 'goblet squat'")
        ).all()
        rdl = connection.execute(
            text("SELECT aliases, primary_muscles FROM exercises WHERE name = 'Romanian deadlift'")
        ).one()
    assert shared >= 80
    assert owned is None or owned == 0
    # The pre-existing shared entry wins over the seed (names compare without case).
    assert goblet == [(existing_id, "my own")]
    assert "RDL" in rdl[0]
    assert "hamstrings" in rdl[1]

    command.downgrade(alembic_config, "5c0aa5e4d191")
    with sync_engine.connect() as connection:
        remaining = connection.execute(text("SELECT id FROM exercises")).all()
    assert remaining == [(existing_id,)]
    sync_engine.dispose()


def test_activity_fields_migration_keeps_strength_logs_and_enforces_values(
    alembic_config, alembic_db_path
):
    command.upgrade(alembic_config, "a7c3e9d2b4f1")
    log_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    insert_log = (
        "INSERT INTO workout_logs (id, performed_at, total_time_minutes, overall_feeling, "
        "source, created_at, updated_at) VALUES (:id, CURRENT_TIMESTAMP, 30, 4, 'manual', "
        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )
    with sync_engine.begin() as connection:
        connection.execute(text(insert_log), {"id": log_id})

    command.upgrade(alembic_config, "c5e1b8f3a6d2")

    with sync_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT total_time_minutes, activity_type, distance_km, effort_rpe "
                "FROM workout_logs WHERE id = :id"
            ),
            {"id": log_id},
        ).one()
    assert row == (30, None, None, None)

    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE workout_logs SET activity_type = 'ice_hockey', effort_rpe = 7 "
                "WHERE id = :id"
            ),
            {"id": log_id},
        )
    for invalid in ("activity_type = 'quidditch'", "effort_rpe = 11", "distance_km = -1"):
        with sync_engine.begin() as connection, pytest.raises(IntegrityError):
            connection.execute(
                text(f"UPDATE workout_logs SET {invalid} WHERE id = :id"), {"id": log_id}
            )

    command.downgrade(alembic_config, "a7c3e9d2b4f1")
    with sync_engine.connect() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(workout_logs)"))}
        kept = connection.execute(
            text("SELECT total_time_minutes FROM workout_logs WHERE id = :id"), {"id": log_id}
        ).scalar_one()
    assert "activity_type" not in columns
    assert kept == 30
    sync_engine.dispose()


def test_scheduled_workout_notes_migration_round_trips(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "d8f2a4c6e1b3")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.connect() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(scheduled_workouts)"))
        }
    assert "notes" in columns

    command.downgrade(alembic_config, "c5e1b8f3a6d2")
    with sync_engine.connect() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(scheduled_workouts)"))
        }
    assert "notes" not in columns
    sync_engine.dispose()


def test_equipment_tags_migration_backfills_from_the_free_text(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "e3a9c1f5b7d2")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO exercises (id, name, aliases, primary_muscles, secondary_muscles, "
                "instructions, equipment, created_at, updated_at) VALUES (:id, 'Own lift', '[]', "
                "'[]', '[]', '[]', 'kettlebell or band', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": str(uuid.uuid4())},
        )
    command.upgrade(alembic_config, "head")

    import json

    with sync_engine.connect() as connection:
        own = connection.scalar(
            text("SELECT equipment_any_of FROM exercises WHERE name = 'Own lift'")
        )
        squat = connection.scalar(
            text("SELECT equipment_any_of FROM exercises WHERE name = 'Back squat'")
        )
        untagged = connection.scalar(
            text(
                "SELECT COUNT(*) FROM exercises WHERE equipment IS NOT NULL "
                "AND equipment_any_of = '[]'"
            )
        )
    assert json.loads(own) == [["kettlebell"], ["band"]]
    assert json.loads(squat) == [["barbell", "rack"]]
    assert untagged == 0
    sync_engine.dispose()


def test_load_events_migration_adds_table_with_checks(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "a7c3e9b1d5f2")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    insert = text(
        "INSERT INTO load_events (id, name, kind, weekday, start_time, duration_minutes, "
        "season_start, season_end, created_at, updated_at) VALUES (:id, 'Game', :kind, "
        ":weekday, '19:30:00.000000', :minutes, '2026-09-01', :end, "
        "'2026-10-16 00:00:00', '2026-10-16 00:00:00')"
    )
    valid = {"kind": "game", "weekday": 5, "minutes": 60, "end": "2027-03-31"}
    with sync_engine.begin() as connection:
        connection.execute(insert, {"id": str(uuid.uuid4()), **valid})
    for override in (
        {"kind": "match"},
        {"weekday": 7},
        {"minutes": 5},
        {"end": "2026-08-31"},
    ):
        with pytest.raises(IntegrityError), sync_engine.begin() as connection:
            connection.execute(insert, {"id": str(uuid.uuid4()), **valid, **override})

    command.downgrade(alembic_config, "d2f6b8a4c1e7")
    assert "load_events" not in set(inspect(sync_engine).get_table_names())
    sync_engine.dispose()


def test_suggestion_note_migration_round_trips(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "b9d1f3a5c7e2")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.connect() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(session_exercises)"))
        }
    assert "suggestion_note" in columns
    command.downgrade(alembic_config, "a7c3e9b1d5f2")
    with sync_engine.connect() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(session_exercises)"))
        }
    assert "suggestion_note" not in columns
    sync_engine.dispose()


def test_coaching_principles_migration_round_trips(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "c2e4a6b8d0f1")
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.connect() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(coaching_principles)"))
        }
    assert columns == {"id", "body", "created_at", "updated_at"}
    command.downgrade(alembic_config, "b9d1f3a5c7e2")
    with sync_engine.connect() as connection:
        tables = {
            row[0]
            for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
    assert "coaching_principles" not in tables
    sync_engine.dispose()


def _load_food_seed_migration():
    import importlib.util

    path = os.path.join(REPO_ROOT, "alembic", "versions", "e7b2c4d6f8a1_seed_basic_foods.py")
    spec = importlib.util.spec_from_file_location("food_seed_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_food_seed_migration_adds_seed_foods_and_keeps_existing(alembic_config, alembic_db_path):
    command.upgrade(alembic_config, "d9e3a7b1c5f4")
    own_id = str(uuid.uuid4())
    sync_engine = create_sync_engine(f"sqlite:///{alembic_db_path}")
    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO foods "
                "(id, owner_id, name, brand, serving_quantity, serving_unit, energy_kcal, "
                "protein_g, carbohydrate_g, fat_g, fiber_g, source, created_at, updated_at) "
                "VALUES (:id, NULL, 'Chléb žitný', NULL, 1, 'slice', 80, 2, 15, 1, 2, "
                "'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": own_id},
        )

    command.upgrade(alembic_config, "e7b2c4d6f8a1")

    with sync_engine.connect() as connection:
        seeded = connection.execute(
            text("SELECT count(*), count(DISTINCT catalog_id) FROM foods WHERE source = 'seed'")
        ).one()
        rye = connection.execute(
            text(
                "SELECT name, serving_quantity, serving_unit, energy_kcal, protein_g, "
                "carbohydrate_g, fat_g, fiber_g, category, vitamins_mg, minerals_mg "
                "FROM foods WHERE catalog_id = 'bread-rye'"
            )
        ).one()
        own = connection.execute(
            text("SELECT name, serving_unit, catalog_id FROM foods WHERE id = :id"), {"id": own_id}
        ).one()
    assert seeded == (37, 37)
    assert rye[:9] == ("Chléb žitný", 100, "g", 215, 6.8, 43.5, 1.2, 6.5, "pečivo")
    assert '"B1": 0.18' in rye[9]
    assert '"Na": 520' in rye[10]
    # A food the user typed in before the seed is left alone, even with the same name.
    assert own == ("Chléb žitný", "slice", None)

    with sync_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE foods SET name = 'Můj chleba', energy_kcal = 200 WHERE catalog_id = 'bread-rye'"
            )
        )
    # Running the seed again neither duplicates rows nor overwrites the edit.
    migration = _load_food_seed_migration()
    with sync_engine.begin() as connection:
        assert migration.insert_missing_seed_foods(connection) == 0
    with sync_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM foods")).scalar_one() == 38
        assert connection.execute(
            text("SELECT name, energy_kcal FROM foods WHERE catalog_id = 'bread-rye'")
        ).one() == ("Můj chleba", 200)
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO foods (id, name, serving_quantity, serving_unit, energy_kcal, "
                    "protein_g, carbohydrate_g, fat_g, source, catalog_id, created_at, updated_at) "
                    "VALUES (:id, 'dup', 100, 'g', 1, 0, 0, 0, 'catalog', 'bread-rye', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": str(uuid.uuid4())},
            )

    command.downgrade(alembic_config, "d9e3a7b1c5f4")
    with sync_engine.connect() as connection:
        remaining = connection.execute(text("SELECT id FROM foods")).all()
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(foods)"))}
    assert remaining == [(own_id,)]
    assert not {"catalog_id", "category", "vitamins_mg", "minerals_mg"} & columns
    sync_engine.dispose()
