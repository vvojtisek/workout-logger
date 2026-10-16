from datetime import date
from uuid import UUID

from pydantic import BaseModel

from app.schemas.load_events import LoadEventOccurrence


class PlanRef(BaseModel):
    id: UUID
    name: str


class LoadWarning(BaseModel):
    """A scheduled workout with heavy leg work too close before hockey."""

    scheduled_workout_id: UUID
    heavy_exercises: list[str]
    events: list[LoadEventOccurrence]
    # The nearest day (earlier first, within three days) with no other workout
    # and no clash; null when there is none.
    move_to: date | None
    # Plans without heavy leg work to swap in, by name.
    swap_plans: list[PlanRef]
