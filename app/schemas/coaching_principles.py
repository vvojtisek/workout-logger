from datetime import datetime

from pydantic import BaseModel, Field

# About ten pages of notes: room for a full philosophy, small enough to hand
# to an assistant in one tool call.
MAX_PRINCIPLES_LENGTH = 20_000


class CoachingPrinciplesUpdate(BaseModel):
    body: str = Field(max_length=MAX_PRINCIPLES_LENGTH)


class CoachingPrinciplesRead(BaseModel):
    body: str
    # None until the principles are first saved.
    updated_at: datetime | None
