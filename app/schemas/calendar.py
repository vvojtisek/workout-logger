from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.scheduled_workouts import ScheduledWorkoutRead

# A calendar query must always be a bounded date range; this is the ceiling
# that keeps it from silently becoming an unbounded history query.
MAX_CALENDAR_SPAN_DAYS = 366


class CalendarRangeQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date_from: date = Field(alias="from")
    date_to: date = Field(alias="to")

    @model_validator(mode="after")
    def range_is_valid(self) -> "CalendarRangeQuery":
        if self.date_to < self.date_from:
            raise ValueError("to must be on or after from")
        if (self.date_to - self.date_from).days > MAX_CALENDAR_SPAN_DAYS:
            raise ValueError(f"date range cannot exceed {MAX_CALENDAR_SPAN_DAYS} days")
        return self


class CalendarResponse(BaseModel):
    items: list[ScheduledWorkoutRead]
