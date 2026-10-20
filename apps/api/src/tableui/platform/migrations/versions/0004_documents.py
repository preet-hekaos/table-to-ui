"""documents: parse jobs for uploaded documents (queued when the parser vendor is down)

Revision ID: 0004
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0004"
down_revision = "0003"

SQL = """
CREATE TABLE control.document_parse (
  file_id uuid PRIMARY KEY REFERENCES control.file(id),
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  parser text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','parsed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  confirmed_record_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_parse_queued ON control.document_parse (updated_at) WHERE status = 'queued';
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
