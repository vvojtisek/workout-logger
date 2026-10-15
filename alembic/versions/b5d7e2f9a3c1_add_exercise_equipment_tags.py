"""Tag exercises with structured equipment.

Revision ID: b5d7e2f9a3c1
Revises: e3a9c1f5b7d2
Create Date: 2026-10-15 21:00:00

Adds `equipment_any_of`, a list of alternatives where each alternative is a
complete set of equipment tags. Existing rows are backfilled from the free-text
`equipment` field; words the parser does not know leave the row untagged ("[]"),
which counts as available everywhere. The free text stays as the display value.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.services.equipment import parse_equipment_text

revision: str = "b5d7e2f9a3c1"
down_revision: str | None = "e3a9c1f5b7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.add_column(
            sa.Column("equipment_any_of", sa.JSON(), nullable=False, server_default="[]")
        )
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, equipment FROM exercises WHERE equipment IS NOT NULL")
    ).all()
    for row_id, equipment in rows:
        tags = parse_equipment_text(equipment)
        if tags:
            connection.execute(
                sa.text("UPDATE exercises SET equipment_any_of = :tags WHERE id = :id"),
                {"tags": json.dumps(tags), "id": row_id},
            )


def downgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.drop_column("equipment_any_of")
