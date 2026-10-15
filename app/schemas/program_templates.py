from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.plans import PlanExerciseCreate
from app.schemas.programs import ProgramRead

Weekday = Annotated[int, Field(ge=0, le=6)]  # Monday = 0, as in datetime.date.weekday()


class TemplatePlan(BaseModel):
    key: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    exercises: list[PlanExerciseCreate] = Field(min_length=1)


class SequenceSession(BaseModel):
    plan: str
    note: str = Field(max_length=2000)


class SequenceSchedule(BaseModel):
    """Plans done in order on whichever weekdays the user trains."""

    type: Literal["sequence"]
    max_sessions_per_week: int = Field(ge=1, le=7)
    default_weekdays: list[Weekday]
    sessions: list[SequenceSession] = Field(min_length=1)


class TemplateWeek(BaseModel):
    week: int = Field(ge=1)
    note: str = Field(max_length=2000)
    days: dict[Weekday, str] = Field(min_length=1)


class WeeklySchedule(BaseModel):
    """Fixed weekdays, week by week, starting on a Monday."""

    type: Literal["weekly"]
    weeks: list[TemplateWeek] = Field(min_length=1)


class ProgramTemplate(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str = Field(max_length=150)
    kind: str = Field(max_length=100)
    location: str
    summary: str
    notes: str
    plans: list[TemplatePlan] = Field(min_length=1)
    schedule: SequenceSchedule | WeeklySchedule = Field(discriminator="type")

    @model_validator(mode="after")
    def schedule_references_known_plans(self) -> "ProgramTemplate":
        keys = {plan.key for plan in self.plans}
        if self.schedule.type == "sequence":
            used = {session.plan for session in self.schedule.sessions}
        else:
            used = {key for week in self.schedule.weeks for key in week.days.values()}
        if not used <= keys:
            raise ValueError(f"schedule references unknown plans: {sorted(used - keys)}")
        return self

    @property
    def session_count(self) -> int:
        if self.schedule.type == "sequence":
            return len(self.schedule.sessions)
        return sum(len(week.days) for week in self.schedule.weeks)


class ProgramTemplateRead(BaseModel):
    key: str
    name: str
    kind: str
    location: str
    summary: str
    schedule_type: Literal["sequence", "weekly"]
    session_count: int
    max_sessions_per_week: int | None
    default_weekdays: list[int] | None
    plan_names: list[str]


class ProgramTemplateListResponse(BaseModel):
    items: list[ProgramTemplateRead]


class ProgramTemplateInstall(BaseModel):
    start_date: date
    # Only used by sequence templates; weekly templates fix their own days.
    weekdays: list[Weekday] | None = Field(default=None, min_length=1, max_length=7)

    @field_validator("weekdays")
    @classmethod
    def weekdays_unique(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("weekdays must not repeat")
        return value


class ProgramTemplateInstallResult(BaseModel):
    program: ProgramRead
    plan_ids: list[UUID]
    scheduled_count: int
