"""What switching Unique, Searchable or Filterable on a field that already exists does to stored records.

The Draft only records the choice. The data work happens when the version goes Live, in the same transaction:
Unique checks the records for duplicates first (and blocks the publish listing them), then fills the comparison
column and builds the index; Searchable rebuilds the search text of the table's records; Filterable adds or drops the lookup index.
"""

import uuid
from collections import Counter
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.domain.ddl import add_field_index_sql, add_shadow_column_sql
from tableui.metadata.domain.models import FieldDef, TableDef
from tableui.metadata.domain.values import normalise, search_document
from tableui.platform.errors import ValidationFailed
from tableui.platform.ids import schema_name
from tableui.platform.sql import split_statements

BATCH = 1000


def _tables(manifest: dict[str, Any] | None) -> dict[str, TableDef]:
    out: dict[str, TableDef] = {}
    for key, t in ((manifest or {}).get("tables") or {}).items():
        d = (t or {}).get("definition")
        if d:
            out[key] = TableDef.model_validate(d)
    return out


def switched(
    before: dict[str, Any] | None, after: dict[str, Any] | None, flag: str
) -> list[tuple[TableDef, FieldDef, bool]]:
    """Fields that exist in both manifests whose `flag` differs: (table in `after`, field in `after`, new value)."""
    old, new = _tables(before), _tables(after)
    out: list[tuple[TableDef, FieldDef, bool]] = []
    for tk, table in new.items():
        was = old.get(tk)
        if was is None:
            continue
        for f in table.fields:
            g = was.field(f.key)
            if g is not None and bool(getattr(g, flag)) != bool(getattr(f, flag)):
                out.append((table, f, bool(getattr(f, flag))))
    return out


async def _enter(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    schema = schema_name(tenant_id)
    await s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
    await s.execute(text(f'SET LOCAL search_path TO "{schema}", public, pg_catalog'))
    return schema


async def _exists(s: AsyncSession, table_key: str) -> bool:
    return bool((await s.execute(text("SELECT to_regclass(:t)"), {"t": f'"{table_key}"'})).scalar())


async def duplicates(
    s: AsyncSession, table: TableDef, f: FieldDef, limit: int = 20
) -> list[dict[str, Any]]:
    """Values held by more than one record, compared the way Unique compares them."""
    if not await _exists(s, table.key):
        return []
    kind = f.normalize or (
        "email" if f.type == "email" else "phone" if f.type == "phone" else "text"
    )
    rows = (
        await s.execute(
            text(
                f"SELECT data->>'{f.key}' AS v FROM \"{table.key}\" "  # noqa: S608 - identifiers are validated metadata keys
                f"WHERE COALESCE(data->>'{f.key}', '') <> '' LIMIT 500000"
            )
        )
    ).all()
    seen: Counter[str] = Counter()
    shown: dict[str, str] = {}
    for r in rows:
        n = normalise(kind, r.v)
        if n is None:
            continue
        seen[n] += 1
        shown.setdefault(n, r.v)
    return [{"value": shown[k], "count": c} for k, c in seen.most_common() if c > 1][:limit]


async def unique_blockers(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Fields about to become Unique whose records already hold the same value twice."""
    await _enter(s, tenant_id)
    out: list[dict[str, Any]] = []
    for table, f, on in switched(before, after, "unique"):
        if not on:
            continue
        dups = await duplicates(s, table, f)
        if dups:
            out.append(
                {
                    "table": table.key,
                    "table_label": table.label,
                    "field": f.key,
                    "label": f.label,
                    "values": dups,
                }
            )
    return out


def blocked_message(blockers: list[dict[str, Any]]) -> ValidationFailed:
    errors = []
    for b in blockers:
        shown = ", ".join(f"{v['value']} ({v['count']})" for v in b["values"][:5])
        errors.append(
            {
                "field": f"{b['table']}.{b['field']}",
                "code": "duplicates",
                "message": f"{b['label']} cannot be unique yet: these values are used more than once: {shown}. Change those records first.",
            }
        )
    return ValidationFailed(errors=errors)


async def _rebuild_search(s: AsyncSession, table: TableDef) -> None:
    last = None
    while True:
        rows = (
            await s.execute(
                text(
                    f'SELECT id, data FROM "{table.key}" WHERE (CAST(:a AS uuid) IS NULL OR id > CAST(:a AS uuid)) '  # noqa: S608 - identifiers are validated metadata keys
                    f"ORDER BY id LIMIT {BATCH}"
                ),
                {"a": last},
            )
        ).all()
        if not rows:
            return
        await s.execute(
            text(f'UPDATE "{table.key}" SET search_doc = :sd WHERE id = :i'),  # noqa: S608 - identifiers are validated metadata keys
            [{"i": r.id, "sd": search_document(table, r.data)} for r in rows],
        )
        last = str(rows[-1].id)


async def _backfill_norm(s: AsyncSession, table: TableDef, f: FieldDef) -> None:
    last = None
    while True:
        rows = (
            await s.execute(
                text(
                    f"SELECT id, data->>'{f.key}' AS v FROM \"{table.key}\" "  # noqa: S608 - identifiers are validated metadata keys
                    f"WHERE (CAST(:a AS uuid) IS NULL OR id > CAST(:a AS uuid)) ORDER BY id LIMIT {BATCH}"
                ),
                {"a": last},
            )
        ).all()
        if not rows:
            return
        await s.execute(
            text(f'UPDATE "{table.key}" SET "{f.key}_norm" = :n WHERE id = :i'),  # noqa: S608 - identifiers are validated metadata keys
            [{"i": r.id, "n": normalise(f.normalize or "text", r.v)} for r in rows],
        )
        last = str(rows[-1].id)


async def apply(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    *,
    enforce_unique: bool = True,
) -> None:
    """Make the stored records match the settings of the version going Live. Raises, rolling the publish back, on duplicates."""
    schema = await _enter(s, tenant_id)
    if enforce_unique:
        blockers = await unique_blockers(s, tenant_id, before, after)
        if blockers:
            raise blocked_message(blockers)
    for table, f, on in switched(before, after, "unique"):
        if not await _exists(s, table.key):
            continue
        if on:
            if not enforce_unique:
                continue
            for stmt in split_statements(add_shadow_column_sql(schema, table.key, f.key, True)):
                await s.execute(text(stmt))
            await _backfill_norm(s, table, f)
        else:
            await s.execute(text(f'DROP INDEX IF EXISTS "{schema}"."{table.key}_{f.key}_unique"'))
            for stmt in split_statements(add_shadow_column_sql(schema, table.key, f.key, False)):
                await s.execute(text(stmt))
    rebuilt: set[str] = set()
    for table, _f, _on in switched(before, after, "searchable"):
        if table.key not in rebuilt and await _exists(s, table.key):
            await _rebuild_search(s, table)
            rebuilt.add(table.key)
    for table, f, on in switched(before, after, "filterable"):
        if not await _exists(s, table.key):
            continue
        if on:
            await s.execute(text(add_field_index_sql(schema, table.key, f.key)))
        elif f.type != "reference":
            await s.execute(text(f'DROP INDEX IF EXISTS "{schema}"."{table.key}_{f.key}_data"'))
