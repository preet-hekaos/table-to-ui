"""catalog: a published pack version keeps its full content, so workspaces update to exactly it

Revision ID: 0006
"""

from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade() -> None:
    op.execute(
        "ALTER TABLE control.pack_release ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb"
    )
    op.execute(
        "ALTER TABLE control.pack_release ADD COLUMN results jsonb NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    raise NotImplementedError("forward-only")
