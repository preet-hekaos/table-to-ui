"""ai: per-workspace switch and cap, the call log, and the 24-hour answer cache

Revision ID: 0011
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0011"
down_revision = "0010"

SQL = """
CREATE TABLE control.ai_setting (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(id),
  enabled boolean NOT NULL DEFAULT false,
  tables text[] NOT NULL DEFAULT '{}',
  monthly_token_cap integer NOT NULL DEFAULT 200000 CHECK (monthly_token_cap >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE control.ai_call (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL,
  feature text NOT NULL,
  prompt_version text NOT NULL,
  subject text,
  provider text,
  model text,
  input_chars integer NOT NULL DEFAULT 0,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  outcome text NOT NULL CHECK (outcome IN ('ok','cached','bad_reply','provider_error','refused')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_call_month ON control.ai_call (tenant_id, created_at DESC);
CREATE TABLE control.ai_cache (
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, input_hash)
);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
