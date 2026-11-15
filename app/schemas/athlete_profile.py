from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import require_non_empty

ConstraintKind = Literal["allergy", "intolerance", "exclusion"]
# "severe" and "strict" are hard exclusions; "preference" is advice only.
ConstraintSeverity = Literal["severe", "strict", "preference"]


class DietaryConstraint(BaseModel):
    item: str = Field(
        min_length=1,
        max_length=100,
        description="What to avoid, e.g. 'fish and seafood', 'gluten', 'cooked dill'.",
    )
    kind: ConstraintKind
    severity: ConstraintSeverity = "strict"
    note: str | None = Field(default=None, max_length=200)
    match_terms: list[str] | None = Field(
        default=None,
        max_length=40,
        description=(
            "Ingredient words the server rejects in meal plans for a severe or strict "
            "constraint. Omitted: the item itself. Empty list: not checked by the server, "
            "only read by the assistant (use it for conditional rules such as 'no cooked dill')."
        ),
    )

    @field_validator("item")
    @classmethod
    def item_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "item")

    @field_validator("match_terms")
    @classmethod
    def clean_terms(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        terms = []
        for term in value:
            cleaned = term.strip().lower()
            if not cleaned or len(cleaned) > 60:
                raise ValueError("match_terms entries must be 1-60 characters")
            if cleaned not in terms:
                terms.append(cleaned)
        return terms

    @property
    def enforced_terms(self) -> list[str]:
        if self.severity == "preference":
            return []
        if self.match_terms is None:
            return [self.item.strip().lower()]
        return self.match_terms


class AthleteProfileReplace(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    longevity_goals: list[str] = Field(default_factory=list, max_length=12)
    dietary_constraints: list[DietaryConstraint] = Field(default_factory=list, max_length=40)
    physical_constraints: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("longevity_goals", "physical_constraints")
    @classmethod
    def clean_lines(cls, value: list[str]) -> list[str]:
        lines = [line.strip() for line in value if line.strip()]
        if any(len(line) > 200 for line in lines):
            raise ValueError("each entry must be at most 200 characters")
        return lines


class AthleteProfileRead(AthleteProfileReplace):
    updated_at: datetime | None = None
