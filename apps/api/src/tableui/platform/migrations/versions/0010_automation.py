"""automation: runs, notifications and their preferences, the hourly clock, guide state, sample data

Revision ID: 0010
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0010"
down_revision = "0009"

SQL = """
CREATE TABLE control.automation_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  automation_key text NOT NULL,
  label text NOT NULL,
  table_key text NOT NULL,
  record_id uuid NOT NULL,
  trigger_key text NOT NULL,
  depth integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('done','retrying','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  outcome jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_try_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, automation_key, record_id, trigger_key)
);
CREATE INDEX automation_run_recent ON control.automation_run (tenant_id, created_at DESC);
CREATE INDEX automation_run_retry ON control.automation_run (next_try_at) WHERE status = 'retrying';
CREATE TABLE control.notification (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  kind text NOT NULL,
  title text NOT NULL,
  link text,
  table_key text,
  record_id uuid,
  source text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  emailed_at timestamptz,
  digested_at timestamptz
);
CREATE INDEX notification_inbox ON control.notification (tenant_id, user_id, created_at DESC);
CREATE UNIQUE INDEX notification_dedupe ON control.notification (tenant_id, user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE TABLE control.notification_pref (
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  digest boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE control.automation_clock (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(id),
  date_checked_at timestamptz NOT NULL DEFAULT 'epoch',
  digest_sent_on date
);
CREATE TABLE control.guide_state (
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE control.sample_batch (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  records jsonb NOT NULL,
  loaded_by uuid NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX sample_batch_tenant ON control.sample_batch (tenant_id) WHERE removed_at IS NULL;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schema_name FROM control.tenant LOOP
    EXECUTE format('ALTER TABLE %I.metadata_object DROP CONSTRAINT IF EXISTS metadata_object_kind_check', r.schema_name);
    EXECUTE format($f$ALTER TABLE %I.metadata_object ADD CONSTRAINT metadata_object_kind_check
      CHECK (kind IN ('pack','table','rule','measure','automation','screen','nav'))$f$, r.schema_name);
  END LOOP;
END $$;
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
