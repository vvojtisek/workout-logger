import uuid
from datetime import date, datetime

from sqlalchemy import JSON, CheckConstraint, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin, utcnow
from app.services.readiness_score import ReadinessInputs, load_factor, readiness_score


class ReadinessLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A subjective recovery check-in. Several per day are allowed; the
    newest one counts. Scores and load factors are computed, not stored
    (app/services/readiness.py), so a rule change never needs a backfill."""

    __tablename__ = "readiness_logs"
    __table_args__ = (
        CheckConstraint(
            "soreness IS NULL OR soreness BETWEEN 1 AND 10", name="ck_readiness_logs_soreness"
        ),
        CheckConstraint(
            "fatigue IS NULL OR fatigue BETWEEN 1 AND 10", name="ck_readiness_logs_fatigue"
        ),
        CheckConstraint(
            "sleep_quality IS NULL OR sleep_quality BETWEEN 1 AND 10",
            name="ck_readiness_logs_sleep_quality",
        ),
        CheckConstraint(
            "soreness IS NOT NULL OR fatigue IS NOT NULL OR sleep_quality IS NOT NULL",
            name="ck_readiness_logs_has_metric",
        ),
        CheckConstraint(
            "prior_day_strain IN ('none', 'moderate', 'high')",
            name="ck_readiness_logs_prior_day_strain",
        ),
        CheckConstraint(
            "strain_source IN ('manual', 'derived')", name="ck_readiness_logs_strain_source"
        ),
        CheckConstraint("source IN ('app', 'mcp', 'api')", name="ck_readiness_logs_source"),
        Index("ix_readiness_logs_owner_date", "owner_id", "log_date"),
        Index("ix_readiness_logs_logged_at", "logged_at"),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_readiness_logs_owner_id_users"),
        nullable=True,
    )
    log_date: Mapped[date] = mapped_column(Date(), nullable=False)
    logged_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utcnow)
    # 1 = no soreness, 10 = very sore.
    soreness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sore_muscle_groups: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # 1 = fresh, 10 = exhausted. The phone asks for energy and stores 11 - energy.
    fatigue: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 1 = very poor, 10 = excellent.
    sleep_quality: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prior_day_strain: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    strain_source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    physical_constraints: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="app")

    @property
    def inputs(self) -> ReadinessInputs:
        return ReadinessInputs(
            soreness=self.soreness,
            fatigue=self.fatigue,
            sleep_quality=self.sleep_quality,
            prior_day_strain=self.prior_day_strain,
            sore_muscle_groups=tuple(self.sore_muscle_groups or ()),
        )

    @property
    def score(self) -> int:
        return readiness_score(self.inputs)

    @property
    def load_factor(self) -> float:
        return load_factor(self.score)
