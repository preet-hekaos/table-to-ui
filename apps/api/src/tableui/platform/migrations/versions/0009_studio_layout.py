"""studio_layout: where each table box sits on the Studio canvas (cosmetic, per workspace)

Revision ID: 0009
"""

from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade() -> None:
    op.execute(
        """
CREATE TABLE control.studio_layout (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(id),
  positions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
)
"""
    )


def downgrade() -> None:
    raise NotImplementedError("forward-only")
