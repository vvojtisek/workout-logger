"""Add the AI coach loop: profile, readiness, meal plans, supplements, prescriptions.

Revision ID: d1a5c7e9b3f2
Revises: c3a8f2e6b1d4
Create Date: 2026-11-15 08:00:00

Additive only. New tables are empty; new columns are nullable or default to
the value that describes every existing row ("user" plans and targets). The
workout log activity check gains "sauna", done with a SQLite table copy
that keeps every row. See ARCHITECTURE_PLAN.md section 4.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "d1a5c7e9b3f2"
down_revision: str | None = "c3a8f2e6b1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ACTIVITY_TYPES = "('ice_hockey', 'swimming', 'cycling', 'hiking', 'running', 'other')"
NEW_ACTIVITY_TYPES = "('ice_hockey', 'swimming', 'sauna', 'cycling', 'hiking', 'running', 'other')"


def upgrade() -> None:
    op.create_table(
        "athlete_profiles",
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("birth_year", sa.Integer(), nullable=True),
        sa.Column("longevity_goals", sa.JSON(), nullable=False),
        sa.Column("dietary_constraints", sa.JSON(), nullable=False),
        sa.Column("physical_constraints", sa.JSON(), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100",
            name="ck_athlete_profiles_birth_year",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_athlete_profiles_owner_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_athlete_profiles_owner",
        "athlete_profiles",
        ["owner_id"],
        unique=True,
        sqlite_where=sa.text("owner_id IS NOT NULL"),
    )
    op.create_table(
        "daily_meal_plans",
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("plan_date", sa.Date(), nullable=False),
        sa.Column("energy_target_kcal", sa.REAL(), nullable=False),
        sa.Column("protein_target_g", sa.REAL(), nullable=False),
        sa.Column("fiber_target_g", sa.REAL(), nullable=True),
        sa.Column("carbohydrate_target_g", sa.REAL(), nullable=True),
        sa.Column("fat_target_g", sa.REAL(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("source IN ('coach', 'manual')", name="ck_daily_meal_plans_source"),
        sa.CheckConstraint(
            "energy_target_kcal >= 0 AND protein_target_g >= 0", name="ck_daily_meal_plans_targets"
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_daily_meal_plans_owner_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_daily_meal_plans_owner_date",
        "daily_meal_plans",
        ["owner_id", "plan_date"],
        unique=True,
        sqlite_where=sa.text("owner_id IS NOT NULL"),
    )
    op.create_index(
        "uq_daily_meal_plans_unowned_date",
        "daily_meal_plans",
        ["plan_date"],
        unique=True,
        sqlite_where=sa.text("owner_id IS NULL"),
    )
    op.create_table(
        "readiness_logs",
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("log_date", sa.Date(), nullable=False),
        sa.Column("logged_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("soreness", sa.Integer(), nullable=True),
        sa.Column("sore_muscle_groups", sa.JSON(), nullable=False),
        sa.Column("fatigue", sa.Integer(), nullable=True),
        sa.Column("sleep_quality", sa.Integer(), nullable=True),
        sa.Column("prior_day_strain", sa.String(length=20), nullable=False),
        sa.Column("strain_source", sa.String(length=20), nullable=False),
        sa.Column("physical_constraints", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "prior_day_strain IN ('none', 'moderate', 'high')",
            name="ck_readiness_logs_prior_day_strain",
        ),
        sa.CheckConstraint("source IN ('app', 'mcp', 'api')", name="ck_readiness_logs_source"),
        sa.CheckConstraint(
            "strain_source IN ('manual', 'derived')", name="ck_readiness_logs_strain_source"
        ),
        sa.CheckConstraint(
            "fatigue IS NULL OR fatigue BETWEEN 1 AND 10", name="ck_readiness_logs_fatigue"
        ),
        sa.CheckConstraint(
            "sleep_quality IS NULL OR sleep_quality BETWEEN 1 AND 10",
            name="ck_readiness_logs_sleep_quality",
        ),
        sa.CheckConstraint(
            "soreness IS NOT NULL OR fatigue IS NOT NULL OR sleep_quality IS NOT NULL",
            name="ck_readiness_logs_has_metric",
        ),
        sa.CheckConstraint(
            "soreness IS NULL OR soreness BETWEEN 1 AND 10", name="ck_readiness_logs_soreness"
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_readiness_logs_owner_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_readiness_logs_logged_at", "readiness_logs", ["logged_at"], unique=False)
    op.create_index(
        "ix_readiness_logs_owner_date", "readiness_logs", ["owner_id", "log_date"], unique=False
    )
    op.create_table(
        "supplement_schedules",
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("dose", sa.REAL(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("timing", sa.String(length=20), nullable=False),
        sa.Column("applies_on", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "applies_on IN ('daily', 'training_days', 'rest_days', 'hockey_days')",
            name="ck_supplement_schedules_applies_on",
        ),
        sa.CheckConstraint(
            "timing IN ('morning', 'pre_workout', 'post_workout', 'with_meal', 'evening', 'bedtime')",
            name="ck_supplement_schedules_timing",
        ),
        sa.CheckConstraint("dose > 0", name="ck_supplement_schedules_dose"),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name="fk_supplement_schedules_owner_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_supplement_schedules_owner_active",
        "supplement_schedules",
        ["owner_id", "active"],
        unique=False,
    )
    op.create_table(
        "grocery_items",
        sa.Column("day_plan_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("name_key", sa.String(length=150), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("quantity", sa.REAL(), nullable=False),
        sa.Column("checked", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_grocery_items_quantity"),
        sa.ForeignKeyConstraint(["day_plan_id"], ["daily_meal_plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day_plan_id", "name_key", "unit"),
    )
    op.create_table(
        "planned_meals",
        sa.Column("day_plan_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("meal_type", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("prep_steps", sa.JSON(), nullable=False),
        sa.Column("energy_kcal", sa.REAL(), nullable=False),
        sa.Column("protein_g", sa.REAL(), nullable=False),
        sa.Column("carbohydrate_g", sa.REAL(), nullable=False),
        sa.Column("fat_g", sa.REAL(), nullable=False),
        sa.Column("fiber_g", sa.REAL(), nullable=True),
        sa.Column("eaten_meal_entry_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')", name="ck_planned_meals_type"
        ),
        sa.CheckConstraint(
            "energy_kcal >= 0 AND protein_g >= 0 AND carbohydrate_g >= 0 AND fat_g >= 0",
            name="ck_planned_meals_macros",
        ),
        sa.ForeignKeyConstraint(["day_plan_id"], ["daily_meal_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["eaten_meal_entry_id"], ["meal_entries.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day_plan_id", "sort_order"),
        sa.UniqueConstraint("eaten_meal_entry_id"),
    )
    op.create_table(
        "supplement_intakes",
        sa.Column("schedule_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("intake_date", sa.Date(), nullable=False),
        sa.Column("taken_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.ForeignKeyConstraint(["schedule_id"], ["supplement_schedules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("schedule_id", "intake_date"),
    )
    op.create_table(
        "planned_meal_ingredients",
        sa.Column("meal_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("quantity", sa.REAL(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("food_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("energy_kcal", sa.REAL(), nullable=True),
        sa.Column("protein_g", sa.REAL(), nullable=True),
        sa.Column("carbohydrate_g", sa.REAL(), nullable=True),
        sa.Column("fat_g", sa.REAL(), nullable=True),
        sa.Column("fiber_g", sa.REAL(), nullable=True),
        sa.Column("prepared", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_planned_meal_ingredients_quantity"),
        sa.ForeignKeyConstraint(["food_id"], ["foods.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meal_id"], ["planned_meals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("meal_id", "sort_order"),
    )
    with op.batch_alter_table("workout_plans") as batch_op:
        batch_op.add_column(
            sa.Column("origin", sa.String(length=10), server_default="user", nullable=False)
        )
        batch_op.create_check_constraint("ck_workout_plans_origin", "origin IN ('user', 'coach')")

    # Plain ADD COLUMN with column-level checks, as the target_rir migration
    # did: a batch table copy would turn those checks into table-level ones
    # and break older downgrades that drop target_rir natively.
    op.add_column(
        "plan_exercises",
        sa.Column(
            "target_rpe",
            sa.Integer(),
            sa.CheckConstraint(
                "target_rpe IS NULL OR (exercise_kind = 'strength' AND target_rpe BETWEEN 1 AND 10)",
                name="ck_plan_exercises_target_rpe_range",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "plan_exercises",
        sa.Column(
            "target_source",
            sa.String(length=10),
            sa.CheckConstraint(
                "target_source IN ('user', 'coach')", name="ck_plan_exercises_target_source"
            ),
            server_default="user",
            nullable=False,
        ),
    )
    op.add_column(
        "plan_exercises", sa.Column("coach_rationale", sa.String(length=240), nullable=True)
    )
    op.add_column(
        "session_exercises",
        sa.Column(
            "target_source",
            sa.String(length=10),
            sa.CheckConstraint(
                "target_source IN ('user', 'coach')", name="ck_session_exercises_target_source"
            ),
            server_default="user",
            nullable=False,
        ),
    )
    op.add_column(
        "session_exercises", sa.Column("coach_rationale", sa.String(length=240), nullable=True)
    )
    op.add_column("session_exercises", sa.Column("readiness_factor", sa.REAL(), nullable=True))

    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.add_column(sa.Column("laps", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("sauna_rounds", sa.Integer(), nullable=True))
        batch_op.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch_op.create_check_constraint(
            "ck_workout_logs_activity_type",
            f"activity_type IS NULL OR activity_type IN {NEW_ACTIVITY_TYPES}",
        )
        batch_op.create_check_constraint("ck_workout_logs_laps", "laps IS NULL OR laps >= 0")
        batch_op.create_check_constraint(
            "ck_workout_logs_sauna_rounds", "sauna_rounds IS NULL OR sauna_rounds BETWEEN 0 AND 20"
        )


def downgrade() -> None:
    # The old constraints cannot hold these rows; fail instead of deleting data.
    bind = op.get_bind()
    blocked = {
        "sauna logs": "SELECT COUNT(*) FROM workout_logs WHERE activity_type = 'sauna'",
    }
    for label, query in blocked.items():
        if bind.execute(sa.text(query)).scalar():
            raise RuntimeError(f"Cannot downgrade: {label} exist and the old schema rejects them")

    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.drop_constraint("ck_workout_logs_sauna_rounds", type_="check")
        batch_op.drop_constraint("ck_workout_logs_laps", type_="check")
        batch_op.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch_op.create_check_constraint(
            "ck_workout_logs_activity_type",
            f"activity_type IS NULL OR activity_type IN {OLD_ACTIVITY_TYPES}",
        )
        batch_op.drop_column("sauna_rounds")
        batch_op.drop_column("laps")

    for column in ("readiness_factor", "coach_rationale", "target_source"):
        op.drop_column("session_exercises", column)
    for column in ("coach_rationale", "target_source", "target_rpe"):
        op.drop_column("plan_exercises", column)

    with op.batch_alter_table("workout_plans") as batch_op:
        batch_op.drop_constraint("ck_workout_plans_origin", type_="check")
        batch_op.drop_column("origin")

    for table in (
        "planned_meal_ingredients",
        "supplement_intakes",
        "planned_meals",
        "grocery_items",
        "supplement_schedules",
        "readiness_logs",
        "daily_meal_plans",
        "athlete_profiles",
    ):
        op.drop_table(table)
