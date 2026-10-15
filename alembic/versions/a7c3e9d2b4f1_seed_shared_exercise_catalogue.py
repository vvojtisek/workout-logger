"""Seed the shared exercise catalogue.

Revision ID: a7c3e9d2b4f1
Revises: 5c0aa5e4d191
Create Date: 2026-10-15 12:00:00

Inserts about 80 common exercises as shared, read-only templates (no owner),
so a new account can build plans from a ready list instead of an empty
catalogue. The data lives in a frozen file next to this revision; later
catalogue changes need a new revision rather than an edit to that file.
An existing shared exercise with the same name (case-insensitive) is kept.
"""

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "a7c3e9d2b4f1"
down_revision: str | None = "5c0aa5e4d191"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_FILE = Path(__file__).resolve().parents[1] / "seed" / "exercise_catalogue_v1.json"

exercises = sa.table(
    "exercises",
    sa.column("id", app.models.base.GUID(length=36)),
    sa.column("owner_id", app.models.base.GUID(length=36)),
    sa.column("name", sa.String(150)),
    sa.column("aliases", sa.JSON()),
    sa.column("media_url", sa.String(2000)),
    sa.column("primary_muscles", sa.JSON()),
    sa.column("secondary_muscles", sa.JSON()),
    sa.column("instructions", sa.JSON()),
    sa.column("equipment", sa.String(200)),
    sa.column("safety_notes", sa.Text()),
    sa.column("created_at", app.models.base.UTCDateTime(timezone=True)),
    sa.column("updated_at", app.models.base.UTCDateTime(timezone=True)),
)


def _seed() -> list[dict]:
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


def upgrade() -> None:
    connection = op.get_bind()
    existing = {
        name.lower()
        for (name,) in connection.execute(
            sa.select(exercises.c.name).where(exercises.c.owner_id.is_(None))
        )
    }
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4(),
            "owner_id": None,
            "media_url": None,
            "created_at": now,
            "updated_at": now,
            **entry,
        }
        for entry in _seed()
        if entry["name"].lower() not in existing
    ]
    if rows:
        op.bulk_insert(exercises, rows)


def downgrade() -> None:
    names = [entry["name"] for entry in _seed()]
    op.get_bind().execute(
        sa.delete(exercises).where(exercises.c.owner_id.is_(None), exercises.c.name.in_(names))
    )
