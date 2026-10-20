"""workspace: per-workspace roles and grants, teams, settings, files, saved searches, imports

Revision ID: 0002
"""

from alembic import op

from tableui.platform.sql import split_statements

revision = "0002"
down_revision = "0001"

SQL = """
ALTER TABLE control.tenant
  ADD COLUMN pack_id text,
  ADD COLUMN pack_version text,
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN onboarding_step text NOT NULL DEFAULT 'choose_pack';
ALTER TABLE control.app_user ADD COLUMN active boolean NOT NULL DEFAULT true;

ALTER TABLE control.membership DROP CONSTRAINT membership_role_key_fkey;
ALTER TABLE control.invitation DROP CONSTRAINT invitation_role_key_fkey;

CREATE TABLE control.tenant_role (
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, key)
);
CREATE TABLE control.tenant_role_grant (
  tenant_id uuid NOT NULL,
  role_key text NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (tenant_id, role_key, permission),
  FOREIGN KEY (tenant_id, role_key) REFERENCES control.tenant_role (tenant_id, key) ON DELETE CASCADE
);
CREATE TABLE control.tenant_role_scope (
  tenant_id uuid NOT NULL,
  role_key text NOT NULL,
  table_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('all','own_team','own')),
  PRIMARY KEY (tenant_id, role_key, table_key),
  FOREIGN KEY (tenant_id, role_key) REFERENCES control.tenant_role (tenant_id, key) ON DELETE CASCADE
);
CREATE TABLE control.tenant_field_deny (
  tenant_id uuid NOT NULL,
  role_key text NOT NULL,
  table_key text NOT NULL,
  field_key text NOT NULL,
  PRIMARY KEY (tenant_id, role_key, table_key, field_key),
  FOREIGN KEY (tenant_id, role_key) REFERENCES control.tenant_role (tenant_id, key) ON DELETE CASCADE
);

-- Carry existing workspaces over: they keep the roles they had.
INSERT INTO control.tenant_role (tenant_id, key, name)
  SELECT t.id, r.key, r.name FROM control.tenant t CROSS JOIN control.role r WHERE r.key <> 'platform_operator';
INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission)
  SELECT t.id, g.role_key, g.permission FROM control.tenant t CROSS JOIN control.role_grant g
  WHERE g.role_key <> 'platform_operator';
UPDATE control.tenant SET onboarding_step = 'done', pack_id = 'recruitment', pack_version = '1.0.0';

CREATE TABLE control.team (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TABLE control.team_member (
  team_id uuid NOT NULL REFERENCES control.team(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE control.file (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  kind text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','error')),
  created_by uuid NOT NULL REFERENCES control.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_tenant ON control.file (tenant_id, kind, created_at DESC);

CREATE TABLE control.saved_search (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  table_key text NOT NULL,
  name text NOT NULL,
  query jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_search_user ON control.saved_search (tenant_id, user_id);

CREATE TABLE control.mapping_profile (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  table_key text NOT NULL,
  header_hash text NOT NULL,
  mapping jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, table_key, header_hash)
);

CREATE TABLE control.import_job (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  table_key text NOT NULL,
  file_id uuid NOT NULL REFERENCES control.file(id),
  state text NOT NULL DEFAULT 'uploaded'
    CHECK (state IN ('uploaded','mapped','validated','loading','done','failed','undone')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolutions jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows_read integer NOT NULL DEFAULT 0,
  rows_loaded integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES control.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  undone_at timestamptz
);
CREATE INDEX import_job_tenant ON control.import_job (tenant_id, created_at DESC);

CREATE TABLE control.import_row_error (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES control.import_job(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  reason text NOT NULL,
  raw jsonb NOT NULL
);
CREATE INDEX import_row_error_job ON control.import_row_error (job_id, row_number);

CREATE TABLE control.import_change (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES control.import_job(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update')),
  before jsonb
);
CREATE INDEX import_change_job ON control.import_change (job_id);

CREATE TABLE control.pack_release (
  id uuid PRIMARY KEY,
  pack_id text NOT NULL,
  version text NOT NULL,
  compatible_with text NOT NULL DEFAULT '>=1.0',
  fixtures jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by uuid NOT NULL REFERENCES control.app_user(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version)
);
"""


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
