"""Add per-side and dumbbell volume rules to exercises.

Revision ID: f2b4d6a8c0e1
Revises: b5d8f2a4c6e1
Create Date: 2026-10-19 18:30:00

Adds `equipment_load_mode` ("standard", "single_db", "pair_db") and
`is_unilateral` to exercises (see app/services/volume.py), then sets them on
the shared catalogue. The weight a user types stays one dumbbell; these flags
only change how volume is counted, and volume is computed when read, so
sessions already logged follow the new rules.

"Dumbbell Romanian deadlift" was an alias of the barbell-or-dumbbell
"Romanian deadlift"; it becomes its own shared exercise so the dumbbell
version can count two dumbbells without doubling a barbell lift. A few names
the bundled program templates use become aliases so their sessions match.
Exercises an account owns keep the defaults and are edited on the exercise page.
"""

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "f2b4d6a8c0e1"
down_revision: str | None = "b5d8f2a4c6e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DB_RDL = "Dumbbell Romanian deadlift"

exercises = sa.table(
    "exercises",
    sa.column("id", app.models.base.GUID(length=36)),
    sa.column("owner_id", app.models.base.GUID(length=36)),
    sa.column("name", sa.String(150)),
    sa.column("aliases", sa.JSON()),
    sa.column("primary_muscles", sa.JSON()),
    sa.column("secondary_muscles", sa.JSON()),
    sa.column("instructions", sa.JSON()),
    sa.column("equipment", sa.String(200)),
    sa.column("equipment_any_of", sa.JSON()),
    sa.column("safety_notes", sa.Text()),
    sa.column("created_at", app.models.base.UTCDateTime(timezone=True)),
    sa.column("updated_at", app.models.base.UTCDateTime(timezone=True)),
)

# name -> (equipment_load_mode, is_unilateral), shared catalogue rows only.
RULES: dict[str, tuple[str, bool]] = {
    "Bulgarian split squat": ("pair_db", True),
    "Step-up": ("pair_db", True),
    "Reverse lunge": ("pair_db", False),
    "Walking lunge": ("pair_db", False),
    "Dumbbell floor press": ("pair_db", False),
    "Dumbbell bench press": ("pair_db", False),
    "Incline dumbbell press": ("pair_db", False),
    "Dumbbell shoulder press": ("pair_db", False),
    "Lateral raise": ("pair_db", False),
    "Chest-supported dumbbell row": ("pair_db", False),
    "Dumbbell shrug": ("pair_db", False),
    DB_RDL: ("pair_db", False),
    "Single-leg Romanian deadlift": ("single_db", True),
    "Single-arm dumbbell row": ("single_db", True),
    "Dumbbell biceps curl": ("single_db", True),
    "Hammer curl": ("single_db", True),
    "Goblet squat": ("single_db", False),
    "Lateral lunge": ("single_db", False),
    "Overhead triceps extension": ("single_db", False),
}

# Program-template names that are the same lift as a catalogue entry.
ALIASES: dict[str, list[str]] = {
    "Bulgarian split squat": ["Dumbbell Bulgarian split squat"],
    "Goblet squat": ["Dumbbell goblet squat"],
    "Incline dumbbell press": ["Incline dumbbell bench press"],
    "Dumbbell floor press": ["Neutral-grip dumbbell floor press"],
}


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _shared(connection, name: str):
    return connection.execute(
        sa.text(
            "SELECT id, aliases FROM exercises WHERE owner_id IS NULL AND lower(name) = lower(:n)"
        ),
        {"n": name},
    ).first()


def _set_aliases(connection, row_id, aliases: list[str]) -> None:
    connection.execute(
        sa.text("UPDATE exercises SET aliases = :a WHERE id = :id"),
        {"a": json.dumps(aliases), "id": row_id},
    )


def upgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.add_column(
            sa.Column(
                "equipment_load_mode",
                sa.String(20),
                nullable=False,
                server_default="standard",
            )
        )
        batch_op.add_column(
            sa.Column("is_unilateral", sa.Boolean(), nullable=False, server_default="0")
        )
        batch_op.create_check_constraint(
            "ck_exercises_equipment_load_mode",
            "equipment_load_mode IN ('standard', 'single_db', 'pair_db')",
        )

    connection = op.get_bind()
    rdl = connection.execute(
        sa.text(
            "SELECT id, aliases, primary_muscles, secondary_muscles, instructions, safety_notes "
            "FROM exercises WHERE owner_id IS NULL AND name = 'Romanian deadlift'"
        )
    ).first()
    if rdl is not None and _shared(connection, DB_RDL) is None:
        aliases = _json(rdl.aliases)
        _set_aliases(connection, rdl.id, [a for a in aliases if a.lower() != DB_RDL.lower()])
        now = datetime.now(UTC)
        op.bulk_insert(
            exercises,
            [
                {
                    "id": uuid.uuid4(),
                    "owner_id": None,
                    "name": DB_RDL,
                    "aliases": ["DB RDL"],
                    "primary_muscles": _json(rdl.primary_muscles),
                    "secondary_muscles": _json(rdl.secondary_muscles),
                    "instructions": _json(rdl.instructions),
                    "equipment": "dumbbells",
                    "equipment_any_of": [["dumbbell"]],
                    "safety_notes": rdl.safety_notes,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        )

    for name, extra in ALIASES.items():
        row = _shared(connection, name)
        if row is None:
            continue
        aliases = _json(row.aliases)
        known = {alias.lower() for alias in aliases}
        _set_aliases(connection, row.id, aliases + [a for a in extra if a.lower() not in known])

    for name, (mode, unilateral) in RULES.items():
        connection.execute(
            sa.text(
                "UPDATE exercises SET equipment_load_mode = :mode, is_unilateral = :uni "
                "WHERE owner_id IS NULL AND lower(name) = lower(:name)"
            ),
            {"mode": mode, "uni": unilateral, "name": name},
        )


def downgrade() -> None:
    connection = op.get_bind()
    for name, extra in ALIASES.items():
        row = _shared(connection, name)
        if row is None:
            continue
        aliases = _json(row.aliases)
        _set_aliases(connection, row.id, [a for a in aliases if a not in extra])

    # Undo the split only if upgrade() made it (the alias is gone from the RDL).
    created = _shared(connection, DB_RDL)
    rdl = _shared(connection, "Romanian deadlift")
    if created is not None and rdl is not None and DB_RDL not in _json(rdl.aliases):
        connection.execute(sa.text("DELETE FROM exercises WHERE id = :id"), {"id": created.id})
        _set_aliases(connection, rdl.id, _json(rdl.aliases) + [DB_RDL])

    with op.batch_alter_table("exercises") as batch_op:
        batch_op.drop_constraint("ck_exercises_equipment_load_mode", type_="check")
        batch_op.drop_column("is_unilateral")
        batch_op.drop_column("equipment_load_mode")
