"""ai setup by chat: the conversation and the plans it proposes

Revision ID: 0012
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0012"
down_revision = "0011"

SQL = """
CREATE TABLE control.ai_plan (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  created_by uuid NOT NULL,
  request text NOT NULL,
  reply text NOT NULL DEFAULT '',
  steps jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','applied','undone','discarded')),
  snapshot jsonb,
  after_hash text,
  applied_by uuid,
  applied_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_plan_tenant ON control.ai_plan (tenant_id, created_at DESC);
CREATE TABLE control.ai_chat (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  plan_id uuid REFERENCES control.ai_plan(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_chat_tenant ON control.ai_chat (tenant_id, created_at DESC);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
