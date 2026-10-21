"""duplicates: merges keep a snapshot so they can be undone for seven days; dismissals hide a pair

Revision ID: 0008
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0008"
down_revision = "0007"

SQL = """
CREATE TABLE control.record_merge (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  table_key text NOT NULL,
  kept_id uuid NOT NULL,
  merged_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  merged_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by uuid
);
CREATE INDEX record_merge_tenant ON control.record_merge (tenant_id, merged_at DESC);
CREATE TABLE control.duplicate_dismissal (
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  table_key text NOT NULL,
  a_id uuid NOT NULL,
  b_id uuid NOT NULL,
  dismissed_by uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, table_key, a_id, b_id),
  CHECK (a_id < b_id)
);
GRANT SELECT, INSERT, UPDATE ON control.record_merge TO tableui_runtime;
GRANT SELECT ON control.duplicate_dismissal TO tableui_runtime;
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
