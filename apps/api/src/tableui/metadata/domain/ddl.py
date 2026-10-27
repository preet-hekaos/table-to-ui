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
  kind text NOT NULL CHECK (kind IN ('pack','table','rule','measure','automation','screen','nav')),
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
    cols.append("owner_id uuid NOT NULL")
    cols.append("search_doc text NOT NULL DEFAULT ''")
    cols.append(
        "sort_order double precision"
    )  # the shared hand-made order; null = never placed, listed first
    cols += [f'"{f.key}_norm" text' for f in t.fields if f.normalize]
    cols += [
        "created_at timestamptz NOT NULL DEFAULT now()",
        "updated_at timestamptz NOT NULL DEFAULT now()",
        "created_by uuid NOT NULL",
        "updated_by uuid NOT NULL",
    ]
    out = [f'CREATE TABLE "{s}"."{t.key}" (\n  ' + ",\n  ".join(cols) + "\n);"]
    out.append(f'CREATE INDEX "{t.key}_recent" ON "{s}"."{t.key}" (updated_at DESC, id DESC);')
    out.append(f'CREATE INDEX "{t.key}_owner" ON "{s}"."{t.key}" (owner_id);')
    out.append(
        f'CREATE INDEX "{t.key}_search_trgm" ON "{s}"."{t.key}" USING gin (search_doc gin_trgm_ops);'
    )
    out.append(
        f'CREATE INDEX "{t.key}_search_fts" ON "{s}"."{t.key}" '
        f"USING gin (to_tsvector('simple', search_doc));"
    )
    out.append(
        f'CREATE INDEX "{t.key}_title_trgm" ON "{s}"."{t.key}" '
        f"USING gin ((lower(COALESCE(data->>'{t.title_field}', ''))) gin_trgm_ops);"
    )
    for f in t.fields:
        if f.type == "reference" or f.filterable:
            out.append(
                f'CREATE INDEX IF NOT EXISTS "{t.key}_{f.key}_data" ON "{s}"."{t.key}" ((data->>\'{f.key}\'));'
            )
    for f in t.fields:
        if f.unique:
            out.append(
                f'CREATE UNIQUE INDEX "{t.key}_{f.key}_unique" ON "{s}"."{t.key}" ("{f.key}_norm") '
                f'WHERE "{f.key}_norm" IS NOT NULL;'
            )
        elif f.normalize:
            out.append(f'CREATE INDEX "{t.key}_{f.key}_norm" ON "{s}"."{t.key}" ("{f.key}_norm");')
            if f.type == "text":  # lets duplicate review find near matches
                out.append(
                    f'CREATE INDEX "{t.key}_{f.key}_norm_trgm" ON "{s}"."{t.key}" '
                    f'USING gin ("{f.key}_norm" public.gin_trgm_ops);'
                )
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


def table_ddl_sql(schema: str, table: TableDef) -> str:
    """DDL to add one record table to an existing tenant schema (used by packs and by builders)."""
    return "\n".join(
        [
            _table_ddl(schema, table),
            _rls(schema, [table.key]),
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{schema}"."{table.key}" TO tableui_runtime;',
        ]
    )


def add_shadow_column_sql(schema: str, table_key: str, field_key: str, unique: bool) -> str:
    """DDL when a builder adds a field that needs a normalised shadow column (unique or matched)."""
    out = [
        f'ALTER TABLE "{schema}"."{table_key}" ADD COLUMN IF NOT EXISTS "{field_key}_norm" text;'
    ]
    if unique:
        out.append(
            f'CREATE UNIQUE INDEX IF NOT EXISTS "{table_key}_{field_key}_unique" ON "{schema}"."{table_key}" '
            f'("{field_key}_norm") WHERE "{field_key}_norm" IS NOT NULL;'
        )
    else:
        out.append(
            f'CREATE INDEX IF NOT EXISTS "{table_key}_{field_key}_norm" ON "{schema}"."{table_key}" ("{field_key}_norm");'
        )
    return "\n".join(out)


def add_field_index_sql(schema: str, table_key: str, field_key: str) -> str:
    return (
        f'CREATE INDEX IF NOT EXISTS "{table_key}_{field_key}_data" ON "{schema}"."{table_key}" '
        f"((data->>'{field_key}'));"
    )


def base_schema_sql(schema: str) -> str:
    """A workspace schema with the shared tables and no record tables yet."""
    parts = [_BASE.format(s=schema)]
    parts.append(_rls(schema, ["metadata_object", "record_history", "outbox", "idempotency_key"]))
    parts += [
        f'GRANT USAGE ON SCHEMA "{schema}" TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".metadata_object TO tableui_runtime;',
        f'GRANT SELECT, INSERT ON "{schema}".record_history TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".outbox TO tableui_runtime;',
        f'GRANT SELECT, INSERT, UPDATE ON "{schema}".idempotency_key TO tableui_runtime;',
        f'GRANT SELECT ON "{schema}".schema_migration TO tableui_runtime;',
        f'GRANT USAGE ON ALL SEQUENCES IN SCHEMA "{schema}" TO tableui_runtime;',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" GRANT USAGE ON SEQUENCES TO tableui_runtime;',
        f'INSERT INTO "{schema}".schema_migration (version, name) '  # noqa: S608 - identifiers are validated metadata keys
        f"VALUES ({TENANT_BASE_VERSION}, 'base');",
    ]
    return "\n".join(parts)


def tenant_schema_sql(schema: str, pack: Pack) -> str:
    """Full DDL for a new tenant with a pack installed: base tables plus one table per metadata table."""
    return "\n".join([base_schema_sql(schema), *[table_ddl_sql(schema, t) for t in pack.tables]])
