"""approvals: a change that a rule holds for a manager is stored here until someone decides

Revision ID: 0007
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0007"
down_revision = "0006"

SQL = """
CREATE TABLE control.approval (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  table_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update')),
  record_id uuid,
  expected_version integer,
  payload jsonb NOT NULL,
  checks jsonb NOT NULL,
  check_ids text[] NOT NULL,
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','failed')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  result_record_id uuid,
  error text
);
CREATE INDEX approval_pending ON control.approval (tenant_id, requested_at DESC) WHERE status = 'pending';
CREATE INDEX approval_record ON control.approval (tenant_id, table_key, record_id);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
