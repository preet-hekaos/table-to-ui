"""studio: owner approval before a non-owner's version goes Live

Revision ID: 0003
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0003"
down_revision = "0002"

SQL = """
CREATE TABLE control.release_approval (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  release_id uuid NOT NULL REFERENCES control.release(id),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES control.app_user(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES control.app_user(id),
  decided_at timestamptz
);
CREATE INDEX release_approval_tenant ON control.release_approval (tenant_id, requested_at DESC);
CREATE UNIQUE INDEX release_approval_one_pending ON control.release_approval (tenant_id, release_id)
  WHERE status = 'pending';
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
