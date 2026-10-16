import uuid
from datetime import date, time

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class LoadEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A recurring sport commitment (a hockey game or practice) on one weekday
    for one season. It is training load the planner has to work around."""

    __tablename__ = "load_events"
    __table_args__ = (
        CheckConstraint("kind IN ('game', 'practice')", name="ck_load_events_kind"),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_load_events_weekday"),
        CheckConstraint(
            "duration_minutes BETWEEN 15 AND 300", name="ck_load_events_duration_minutes"
        ),
        CheckConstraint("season_end >= season_start", name="ck_load_events_season"),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_load_events_owner_id_users"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Monday is 0, matching date.weekday() and the Monday-first calendar.
    weekday: Mapped[int] = mapped_column(Integer(), nullable=False)
    start_time: Mapped[time] = mapped_column(Time(), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer(), nullable=False, default=60)
    season_start: Mapped[date] = mapped_column(Date(), nullable=False)
    season_end: Mapped[date] = mapped_column(Date(), nullable=False)
