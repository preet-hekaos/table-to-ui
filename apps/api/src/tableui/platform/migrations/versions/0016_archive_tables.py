"""archive: tables can be archived too

Revision ID: 0016
"""

from alembic import op

revision = "0016"
down_revision = "0015"

SQL = [
    "ALTER TABLE control.archive_item DROP CONSTRAINT archive_item_kind_check",
    "ALTER TABLE control.archive_item ADD CONSTRAINT archive_item_kind_check "
    "CHECK (kind IN ('table','field','link','measure','automation','record'))",
]


def upgrade() -> None:
    for stmt in SQL:
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
