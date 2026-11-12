from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, model_validator

OneRepMaxFormula = Literal["epley", "brzycki", "lombardi", "wathen"]


class ExerciseStatsQuery(BaseModel):
    name: list[Annotated[str, Field(min_length=1, max_length=150)]] = Field(
        min_length=1, max_length=50
    )
    formula: OneRepMaxFormula = Field(
        default="epley",
        description="Epley uses all logged rep counts. Other formulas use 1–10 reps.",
    )
    date_from: AwareDatetime | None = Field(default=None, description="Inclusive start timestamp.")
    date_to: AwareDatetime | None = Field(default=None, description="Exclusive end timestamp.")

    @model_validator(mode="after")
    def validate_date_range(self) -> "ExerciseStatsQuery":
        if (self.date_from is None) != (self.date_to is None):
            raise ValueError("date_from and date_to must be supplied together")
        if (
            self.date_from is not None
            and self.date_to is not None
            and self.date_from >= self.date_to
        ):
            raise ValueError("date_to must be after date_from")
        return self


class ExerciseSessionPoint(BaseModel):
    """One logged session of an exercise, with the set behind its best estimate."""

    performed_at: datetime
    weight_kg: float | None
    top_reps: int | None
    estimated_one_rep_max_kg: float | None


class RepRetentionGroup(BaseModel):
    """Repetition sequence from sets performed at one recorded external load."""

    weight_kg: float
    reps_per_set: list[int]
    retention_percent: float


class FormulaAgreement(BaseModel):
    """Estimates from all equations applied to one common reference set."""

    reference_weight_kg: float
    reference_reps: int
    estimates_kg: dict[OneRepMaxFormula, float]
    spread_percent: float


class ExerciseStatsRead(BaseModel):
    exercise_name: str
    sessions_count: int
    last_performed_at: datetime | None
    last_weight_kg: float | None
    last_reps_per_set: list[int] | None
    best_weight_kg: float | None
    best_weight_reps: int | None
    estimated_one_rep_max_kg: float | None
    trend: Literal["up", "down", "flat"] | None
    # All equations applied to the same set from the most recent session.
    formula_agreement: FormulaAgreement | None = None
    # Same-load set sequences from the most recent session, when comparable.
    rep_retention: list[RepRetentionGroup] = Field(default_factory=list)
    # Up to RECENT_SESSIONS most recent sessions, oldest first.
    recent: list[ExerciseSessionPoint] = Field(default_factory=list)


class ExerciseStatsResponse(BaseModel):
    items: list[ExerciseStatsRead]
