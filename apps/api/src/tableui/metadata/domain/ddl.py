"""Generate a tenant schema from metadata. The only SQL that knows about table shapes."""

from tableui.metadata.domain.models import Pack, TableDef

TENANT_BASE_VERSION = 1

_BASE = """
CREATE SCHEMA "{s}";
CREATE TABLE "{s}".schema_migration (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "{s}".metadata_object (
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pack','table','rule','measure')),
  key text NOT NULL,
  definition jsonb NOT NULL,
  source text NOT NULL DEFAULT 'pack',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);
CREATE TABLE "{s}".record_history (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  table_key text NOT NULL,
  record_id uuid NOT NULL,
  seq integer NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  actor_id uuid NOT NULL,
  app_version text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL,
  UNIQUE (table_key, record_id, seq)
);
CREATE TABLE "{s}".outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON "{s}".outbox (id) WHERE published_at IS NULL;
CREATE TABLE "{s}".idempotency_key (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
"""

_SQL_TYPES = {
    "integer": "bigint",
    "decimal": "numeric",
    "boolean": "boolean",
    "date": "date",
}


def _table_ddl(s: str, t: TableDef) -> str:
    cols = ["id uuid PRIMARY KEY", "tenant_id uuid NOT NULL", "version integer NOT NULL DEFAULT 1"]
    cols.append("data jsonb NOT NULL")
    cols += [f'"{f.key}_norm" text' for f in t.fields if f.normalize]
    cols += [
        "created_at timestamptz NOT NULL DEFAULT now()",
        "updated_at timestamptz NOT NULL DEFAULT now()",
        "created_by uuid NOT NULL",
        "updated_by uuid NOT NULL",
    ]
    out = [f'CREATE TABLE "{s}"."{t.key}" (\n  ' + ",\n  ".join(cols) + "\n);"]
    out.append(f'CREATE INDEX "{t.key}_recent" ON "{s}"."{t.key}" (updated_at DESC, id DESC);')
    for f in t.fields:
        if f.unique:
            out.append(
                f'CREATE UNIQUE INDEX "{t.key}_{f.key}_unique" ON "{s}"."{t.key}" ("{f.key}_norm") '
                f'WHERE "{f.key}_norm" IS NOT NULL;'
            )
        elif f.normalize:
            out.append(f'CREATE INDEX "{t.key}_{f.key}_norm" ON "{s}"."{t.key}" ("{f.key}_norm");')
    return "\n".join(out)


def _rls(s: str, tables: list[str]) -> str:
    out = []
    for name in tables:
        out.append(f'ALTER TABLE "{s}"."{name}" ENABLE ROW LEVEL SECURITY;')
        out.append(f'ALTER TABLE "{s}"."{name}" FORCE ROW LEVEL SECURITY;')
        out.append(
            f'CREATE POLICY tenant_isolation ON "{s}"."{name}" '
            f"USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            f"WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));"
        )
    return "\n".join(out)


def tenant_schema_sql(schema: str, pack: Pack) -> str:
    """Full DDL for a new tenant: base tables, one table per metadata table, RLS and grants."""
    parts = [_BASE.format(s=schema)]
    parts += [_table_ddl(schema, t) for t in pack.tables]
    record_tables = [t.key for t in pack.tables]
    all_tables = ["metadata_object", "record_history", "outbox", "idempotency_key", *record_tables]
    parts.append(_rls(schema, all_tables))
    grants = [
        f'GRANT USAGE ON SCHEMA "{schema}" TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".metadata_object TO tableui_runtime;',
        f'GRANT SELECT, INSERT ON "{schema}".record_history TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".outbox TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".idempotency_key TO tableui_runtime;',
        f'GRANT SELECT ON "{schema}".schema_migration TO tableui_runtime;',
        f'GRANT USAGE ON ALL SEQUENCES IN SCHEMA "{schema}" TO tableui_runtime;',
    ]
    grants += [
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}"."{t}" TO tableui_runtime;'
        for t in record_tables
    ]
    parts += grants
    parts.append(
        f'INSERT INTO "{schema}".schema_migration (version, name) '  # noqa: S608 - identifiers are validated metadata keys
        f"VALUES ({TENANT_BASE_VERSION}, 'base');"
    )
    return "\n".join(parts)
