"""archive: things an admin took out instead of deleting, and the workspace's auto-delete setting

Revision ID: 0015
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0015"
down_revision = "0014"

SQL = """
CREATE TABLE control.archive_item (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  kind text NOT NULL CHECK (kind IN ('field','link','measure','automation','record')),
  table_key text,
  item_key text NOT NULL,
  label text NOT NULL,
  detail text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}',
  archived_by uuid,
  archived_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz,
  warned_at timestamptz
);
CREATE INDEX archive_item_tenant ON control.archive_item (tenant_id, archived_at DESC);
CREATE INDEX archive_item_due ON control.archive_item (delete_after) WHERE delete_after IS NOT NULL;
CREATE TABLE control.archive_setting (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(id),
  auto_delete boolean NOT NULL DEFAULT true,
  days integer NOT NULL DEFAULT 30 CHECK (days BETWEEN 1 AND 3650),
  per_kind jsonb NOT NULL DEFAULT '{}',
  warn_days integer NOT NULL DEFAULT 3 CHECK (warn_days BETWEEN 0 AND 30),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
