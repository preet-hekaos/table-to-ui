"""control plane: tenants, identity, releases, audit

Revision ID: 0001
"""

from alembic import op

revision = "0001"
down_revision = None

SQL = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tableui_runtime') THEN
    CREATE ROLE tableui_runtime NOLOGIN;
  END IF;
END $$;
GRANT tableui_runtime TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS control;

CREATE TABLE control.tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  schema_name text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'trial',
  cluster text NOT NULL DEFAULT 'ap-south-1-a',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning','active','suspended')),
  workos_org_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.role (
  key text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE control.role_grant (
  role_key text NOT NULL REFERENCES control.role(key),
  permission text NOT NULL,
  PRIMARY KEY (role_key, permission)
);

CREATE TABLE control.app_user (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  mfa_secret text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  realm text NOT NULL CHECK (realm IN ('tenant','operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (realm, email)
);

CREATE TABLE control.membership (
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  role_key text NOT NULL REFERENCES control.role(key),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE control.invitation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  email text NOT NULL,
  role_key text NOT NULL REFERENCES control.role(key),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid NOT NULL REFERENCES control.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.session (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES control.app_user(id),
  tenant_id uuid REFERENCES control.tenant(id),
  realm text NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE control.login_attempt (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  realm text NOT NULL,
  succeeded boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_lookup ON control.login_attempt (realm, email, at DESC);

CREATE TABLE control.manifest (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.release (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  version integer NOT NULL,
  manifest_id uuid NOT NULL REFERENCES control.manifest(id),
  created_by uuid NOT NULL REFERENCES control.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

CREATE TABLE control.release_deployment (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenant(id),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  release_id uuid NOT NULL REFERENCES control.release(id),
  action text NOT NULL CHECK (action IN ('publish','rollback')),
  by_user uuid NOT NULL REFERENCES control.app_user(id),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX release_deployment_current ON control.release_deployment (tenant_id, environment, id DESC);

CREATE TABLE control.audit_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  scope text NOT NULL CHECK (scope IN ('tenant','platform')),
  actor_id uuid,
  action text NOT NULL,
  subject_type text,
  subject_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_tenant ON control.audit_event (tenant_id, at DESC);

-- Tenant sessions may only append to the audit log, restricted to their own tenant.
GRANT USAGE ON SCHEMA control TO tableui_runtime;
GRANT INSERT ON control.audit_event TO tableui_runtime;
GRANT USAGE ON SEQUENCE control.audit_event_id_seq TO tableui_runtime;
ALTER TABLE control.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_own_tenant ON control.audit_event FOR INSERT TO tableui_runtime
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

INSERT INTO control.role (key, name) VALUES
  ('admin','Agency admin'), ('manager','Manager'), ('recruiter','Recruiter'),
  ('sourcer','Sourcer'), ('coordinator','Coordinator'), ('finance','Finance'),
  ('viewer','Viewer'), ('platform_operator','Platform operator');

INSERT INTO control.role_grant (role_key, permission) VALUES
  ('admin','metadata.read'), ('admin','release.publish'), ('admin','invitation.send'),
  ('admin','record.candidate.read'), ('admin','record.candidate.create'),
  ('admin','record.candidate.update'), ('admin','measure.read'), ('admin','audit.read'),
  ('manager','metadata.read'), ('manager','record.candidate.read'),
  ('manager','record.candidate.create'), ('manager','record.candidate.update'),
  ('manager','measure.read'), ('manager','audit.read'),
  ('recruiter','record.candidate.read'), ('recruiter','record.candidate.create'),
  ('recruiter','record.candidate.update'), ('recruiter','measure.read'),
  ('sourcer','record.candidate.read'), ('sourcer','record.candidate.create'),
  ('coordinator','record.candidate.read'),
  ('finance','record.candidate.read'), ('finance','measure.read'),
  ('viewer','record.candidate.read'), ('viewer','measure.read'),
  ('platform_operator','ops.tenants.read');
"""


def split_statements(sql: str) -> list[str]:
    """Split on semicolons that are outside $$ ... $$ blocks (asyncpg runs one statement)."""
    out, buf, in_dollar = [], [], False
    for line in sql.splitlines():
        if line.lstrip().startswith("--"):
            continue
        buf.append(line)
        in_dollar ^= line.count("$$") % 2 == 1
        if not in_dollar and line.rstrip().endswith(";"):
            out.append("\n".join(buf).strip())
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        out.append(tail)
    return [s for s in out if s and not s.startswith("--")]


def upgrade() -> None:
    for stmt in split_statements(SQL):
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP SCHEMA control CASCADE")
