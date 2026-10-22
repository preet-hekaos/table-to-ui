"""operator console: workspace lifecycle, limits and exports

Revision ID: 0013
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0013"
down_revision = "0012"

SQL = """
ALTER TABLE control.tenant DROP CONSTRAINT IF EXISTS tenant_status_check;
ALTER TABLE control.tenant ADD CONSTRAINT tenant_status_check
  CHECK (status IN ('provisioning','active','suspended','scheduled_deletion'));
ALTER TABLE control.tenant ADD COLUMN status_reason text;
ALTER TABLE control.tenant ADD COLUMN status_changed_at timestamptz;
ALTER TABLE control.tenant ADD COLUMN delete_after timestamptz;
CREATE TABLE control.tenant_limit (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(id),
  max_people integer CHECK (max_people IS NULL OR max_people >= 1),
  max_records integer CHECK (max_records IS NULL OR max_records >= 0),
  max_storage_mb integer CHECK (max_storage_mb IS NULL OR max_storage_mb >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE control.export_job (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  requested_by uuid NOT NULL,
  sent_to text NOT NULL,
  token_hash text NOT NULL,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_job_tenant ON control.export_job (tenant_id, created_at DESC);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
