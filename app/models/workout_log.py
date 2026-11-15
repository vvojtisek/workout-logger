import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin
from app.services.activity_kinds import ALL_ACTIVITY_TYPES, ActivityCategory, category_of

if TYPE_CHECKING:
    from app.models.exercise_log import ExerciseLog


class WorkoutLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workout_logs"
    __table_args__ = (
        CheckConstraint(
            "activity_type IS NULL OR activity_type IN "
            "(" + ", ".join(f"'{kind}'" for kind in ALL_ACTIVITY_TYPES) + ")",
            name="ck_workout_logs_activity_type",
        ),
        CheckConstraint(
            "effort_level IS NULL OR effort_level BETWEEN 1 AND 5",
            name="ck_workout_logs_effort_level",
        ),
        CheckConstraint(
            "feel_before IS NULL OR feel_before BETWEEN 1 AND 5",
            name="ck_workout_logs_feel_before",
        ),
        CheckConstraint(
            "feel_after IS NULL OR feel_after BETWEEN 1 AND 5", name="ck_workout_logs_feel_after"
        ),
        CheckConstraint("cycles IS NULL OR cycles BETWEEN 1 AND 20", name="ck_workout_logs_cycles"),
        CheckConstraint(
            "cycle_minutes IS NULL OR cycle_minutes BETWEEN 1 AND 240",
            name="ck_workout_logs_cycle_minutes",
        ),
        CheckConstraint(
            "linked_log_id IS NULL OR linked_log_id <> id", name="ck_workout_logs_linked_log_id"
        ),
        CheckConstraint(
            "effort_rpe IS NULL OR effort_rpe BETWEEN 1 AND 10", name="ck_workout_logs_effort_rpe"
        ),
        CheckConstraint(
            "distance_km IS NULL OR distance_km >= 0", name="ck_workout_logs_distance_km"
        ),
        CheckConstraint("laps IS NULL OR laps >= 0", name="ck_workout_logs_laps"),
        CheckConstraint(
            "sauna_rounds IS NULL OR sauna_rounds BETWEEN 0 AND 20",
            name="ck_workout_logs_sauna_rounds",
        ),
        Index("ix_workout_logs_performed_at", "performed_at"),
        Index("ix_workout_logs_source_plan_id", "source_plan_id"),
        Index("ix_workout_logs_linked_log_id", "linked_log_id"),
        Index(
            "uq_workout_logs_owner_source_external_id",
            "owner_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_workout_logs_unowned_source_external_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_workout_logs_owner_id_users"),
        nullable=True,
        index=True,
    )
    source_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="SET NULL"), nullable=True
    )
    source_plan_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    total_time_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    calories_burned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overall_feeling: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    # Set only by /api/v1/ingest/sessions: the sync source's own record id,
    # used to make a re-sync idempotent rather than a signal a human ever reads.
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Set for a non-gym session (hockey, a swim, a ride); NULL for a strength workout.
    activity_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Session RPE on the CR-10 scale; times duration it gives the session's training load.
    effort_rpe: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Pool lengths for a swim, and sauna rounds after it (or on their own).
    laps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sauna_rounds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A custom name for an "other" activity, e.g. "Paddleboarding".
    activity_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Whole-session effort, 1 (recovery, relaxed) to 5 (max effort). A cardio
    # log with an effort level and no RPE gets an RPE derived from it.
    effort_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Physical state before and after, 1 (wrecked) to 5 (fresh).
    feel_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feel_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Rounds of a recovery session (sauna, cold plunge) and minutes per round.
    cycles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cycle_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The session this one followed, e.g. a sauna after a swim.
    linked_log_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey(
            "workout_logs.id",
            ondelete="SET NULL",
            name="fk_workout_logs_linked_log_id_workout_logs",
        ),
        nullable=True,
    )

    exercises: Mapped[list["ExerciseLog"]] = relationship(
        back_populates="workout_log",
        cascade="all, delete-orphan",
        order_by="ExerciseLog.sort_order",
    )

    @property
    def activity_category(self) -> ActivityCategory:
        return category_of(self.activity_type)

    @property
    def total_volume_kg(self) -> float:
        """Sum of each exercise's volume (see app.services.volume)."""
        return round(sum(exercise.volume_kg for exercise in self.exercises), 1)
