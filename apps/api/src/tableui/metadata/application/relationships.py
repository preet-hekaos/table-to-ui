"""Relationship builder: see, add, change and remove the links between tables (all in the Draft).

A link is a reference field on the "many" side. Many-to-many is a small linking table with two
required links. Everything is built from the Studio's own field and table operations, so the
rules about pack-owned fields and additive schema changes stay in one place.
"""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.application import studio
from tableui.metadata.domain.links import describe_cycle, required_cycle
from tableui.metadata.domain.models import FieldDef, TableDef
from tableui.platform.errors import NotFound


async def _tables(s: AsyncSession) -> list[TableDef]:
    rows = await s.execute(
        text("SELECT definition FROM metadata_object WHERE kind = 'table' ORDER BY key")
    )
    return [TableDef.model_validate(r.definition) for r in rows]


async def _used(s: AsyncSession, schema: str, table: str, field: str) -> int:
    """How many records currently hold a value in this link. A table not yet Live has none."""
    exists = (
        await s.execute(text("SELECT to_regclass(:n)"), {"n": f'"{schema}"."{table}"'})
    ).scalar_one()
    if exists is None:
        return 0
    return int(
        (
            await s.execute(
                text(
                    f'SELECT count(*) FROM "{schema}"."{table}" WHERE data->>:f IS NOT NULL'  # noqa: S608 - identifiers are validated metadata keys
                ),
                {"f": field},
            )
        ).scalar_one()
    )


def _link(t: TableDef, f: Any, to: TableDef | None, used: int, total: int = 0) -> dict[str, Any]:
    return {
        "id": f"{t.key}.{f.key}",
        "table": t.key,
        "table_label": t.label,
        "field": f.key,
        "label": f.label,
        "to": f.ref_table,
        "to_label": to.label if to else f.ref_table,
        "required": f.required,
        "hidden": f.hidden,
        "help": f.help,
        "source": f.source,
        "used": used,
        "empty": max(total - used, 0),
        "total": total,
    }


async def _usage(
    s: AsyncSession, schema: str, tables: list[TableDef]
) -> dict[str, tuple[int, int]]:
    """Records using each link: one query per table that exists, not one per link."""
    live = {
        r.relname
        for r in await s.execute(
            text(
                "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :n AND c.relkind = 'r'"
            ),
            {"n": schema},
        )
    }
    out: dict[str, tuple[int, int]] = {}
    for t in tables:
        refs = [f.key for f in t.fields if f.type == "reference"]
        if not refs or t.key not in live:
            continue
        cols = "count(*), " + ", ".join(
            f"count(*) FILTER (WHERE data->>:f{i} IS NOT NULL)" for i in range(len(refs))
        )
        row = (
            await s.execute(
                text(f'SELECT {cols} FROM "{schema}"."{t.key}"'),  # noqa: S608 - identifiers are validated metadata keys
                {f"f{i}": k for i, k in enumerate(refs)},
            )
        ).one()
        out.update({f"{t.key}.{k}": (int(row[i + 1]), int(row[0])) for i, k in enumerate(refs)})
    return out


async def list_links(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    schema = await studio._enter_tenant(s, tenant_id)
    tables = await _tables(s)
    by_key = {t.key: t for t in tables}
    usage = await _usage(s, schema, tables)
    return [
        _link(t, f, by_key.get(f.ref_table or ""), *usage.get(f"{t.key}.{f.key}", (0, 0)))
        for t in tables
        for f in t.fields
        if f.type == "reference"
    ]


async def add_link(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """Each <table> belongs to one <to>: a link field on the many side."""
    await studio._enter_tenant(s, tenant_id)
    tables = {t.key: t for t in await _tables(s)}
    child, parent = str(body.get("table", "")), str(body.get("to", ""))
    if child not in tables:
        raise NotFound(f"There is no table '{child}'.")
    if parent not in tables:
        raise studio._bad("to", "must be a table in this app")
    label = str(body.get("label") or "").strip() or tables[parent].label
    for f in tables[child].fields:
        if f.type == "reference" and f.ref_table == parent and f.label.lower() == label.lower():
            raise studio._bad(
                "label",
                f"{tables[child].label} already links to {tables[parent].label} as '{f.label}'",
                "duplicate",
            )
    if body.get("required"):
        trial = tables[child].model_copy(
            update={
                "fields": [
                    *tables[child].fields,
                    FieldDef(
                        key="new_link",
                        label=label,
                        type="reference",
                        ref_table=parent,
                        required=True,
                    ),
                ]
            }
        )
        cycle = required_cycle([trial, *[t for k, t in tables.items() if k != child]])
        if cycle:
            raise studio._bad(
                "required",
                describe_cycle(cycle, {k: t.label for k, t in tables.items()})
                + " Make one of the links optional.",
                "circular_required",
            )
    field = await studio.add_field(
        s,
        tenant_id=tenant_id,
        user_id=user_id,
        table_key=child,
        body={
            "label": label,
            "type": "reference",
            "ref_table": parent,
            "required": bool(body.get("required")),
            "help": body.get("help"),
        },
        request_id=request_id,
    )
    return _link(tables[child], FieldDef.model_validate(field), tables[parent], 0)


async def add_many_to_many(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """A linking table with two required links, so each pair of records is one row."""
    await studio._enter_tenant(s, tenant_id)
    tables = {t.key: t for t in await _tables(s)}
    a, b = str(body.get("a", "")), str(body.get("b", ""))
    for k in (a, b):
        if k not in tables:
            raise NotFound(f"There is no table '{k}'.")
    if a == b:
        raise studio._bad("b", "pick two different tables")
    label = str(body.get("label") or "").strip() or f"{tables[a].label} and {tables[b].label}"
    table = await studio.create_table(
        s,
        tenant_id=tenant_id,
        user_id=user_id,
        body={
            "label": label,
            "plural_label": str(body.get("plural_label") or "").strip() or f"{label} links",
            "title_label": "Note",
            "description": f"Links {tables[a].plural_label} and {tables[b].plural_label}.",
        },
        request_id=request_id,
    )
    key = table["key"]
    await studio._enter_tenant(s, tenant_id)  # the table DDL changed the search path
    found = await studio._draft(s, "table", key)
    assert found is not None
    definition, source = found
    definition["fields"] = [
        {**f, "required": False} if f["key"] == definition["title_field"] else f
        for f in definition["fields"]
    ]
    await studio._put(s, tenant_id, "table", key, definition, source)
    for side in (a, b):
        await add_link(
            s,
            tenant_id=tenant_id,
            user_id=user_id,
            body={"table": key, "to": side, "label": tables[side].label, "required": True},
            request_id=request_id,
        )
    await studio._audit(
        s,
        tenant_id,
        user_id,
        "metadata.relationship.many_to_many",
        key,
        {"a": a, "b": b},
        request_id,
    )
    return {"table": key, "label": label, "links": [a, b]}


async def remove_link(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    table_key: str,
    field_key: str,
    request_id: str | None,
) -> None:
    """Only an agency link that no record, screen or table setting uses."""
    schema = await studio._enter_tenant(s, tenant_id)
    found = await studio._draft(s, "table", table_key)
    if found is None:
        raise NotFound(f"There is no table '{table_key}'.")
    table = TableDef.model_validate(found[0])
    f = table.field(field_key)
    if f is None or f.type != "reference":
        raise NotFound(f"There is no link '{field_key}' on '{table_key}'.")
    used = await _used(s, schema, table_key, field_key)
    if f.source != "pack" and used:
        raise studio._bad(
            "field",
            f"{used} record{'s' if used != 1 else ''} use this link; clear it there first, or hide the link instead",
            "in_use",
        )
    rows = await s.execute(
        text("SELECT kind, key, definition FROM metadata_object WHERE kind IN ('screen', 'table')")
    )
    for r in rows:
        if _refers(r.kind, r.definition, table_key, field_key):
            raise studio._bad("field", f"{r.kind} '{r.key}' uses this link", "in_use")
    await studio.remove_field(
        s,
        tenant_id=tenant_id,
        user_id=user_id,
        table_key=table_key,
        field_key=field_key,
        request_id=request_id,
    )


def _refers(kind: str, d: dict[str, Any], table_key: str, field_key: str) -> bool:
    """A related-list or search setting on another table, or a screen setting, names this link."""
    if kind == "table":
        return any(
            x.get("table") == table_key and x.get("via") == field_key
            for group in ("counts", "search_includes")
            for x in d.get(group, []) or []
        )
    return d.get("table") == table_key and f'"{field_key}"' in json.dumps(d.get("config", {}) or {})


MAX_BOXES = 1000


async def get_layout(s: AsyncSession, tenant_id: uuid.UUID) -> dict[str, dict[str, float]]:
    row = (
        await s.execute(
            text("SELECT positions FROM control.studio_layout WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
    ).first()
    return dict(row.positions) if row else {}


async def save_layout(
    s: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, positions: dict[str, Any]
) -> dict[str, dict[str, float]]:
    """Remember where each table box sits. Cosmetic: not part of any release."""
    await studio._enter_tenant(s, tenant_id)
    keys = {t.key for t in await _tables(s)}
    clean: dict[str, dict[str, float]] = {}
    for k, v in positions.items():
        if k not in keys:
            continue
        try:
            x, y = float(v["x"]), float(v["y"])
        except (KeyError, TypeError, ValueError):
            raise studio._bad("positions", f"'{k}' needs numbers x and y") from None
        if abs(x) > 100_000 or abs(y) > 100_000:
            raise studio._bad("positions", f"'{k}' is too far from the origin")
        clean[k] = {"x": round(x, 1), "y": round(y, 1)}
        if len(clean) > MAX_BOXES:
            raise studio._bad("positions", "too many tables")
    await s.execute(
        text(
            "INSERT INTO control.studio_layout (tenant_id, positions, updated_by) "
            "VALUES (:t, CAST(:p AS jsonb), :u) "
            "ON CONFLICT (tenant_id) DO UPDATE SET positions = EXCLUDED.positions, "
            "updated_by = EXCLUDED.updated_by, updated_at = now()"
        ),
        {"t": tenant_id, "p": json.dumps(clean), "u": user_id},
    )
    return clean


async def health(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    """Plain-words problems and notes about the links in the Draft."""
    schema = await studio._enter_tenant(s, tenant_id)
    tables = await _tables(s)
    labels = {t.key: t.label for t in tables}
    usage = await _usage(s, schema, tables)
    issues: list[dict[str, Any]] = []

    def add(kind: str, severity: str, link: str | None, message: str) -> None:
        issues.append({"kind": kind, "severity": severity, "link": link, "message": message})

    cycle = required_cycle(tables)
    if cycle:
        add(
            "circular_required",
            "problem",
            None,
            describe_cycle(cycle, labels) + " Make one of the links optional.",
        )
    pairs: dict[tuple[str, str], list[str]] = {}
    for t in tables:
        for f in t.fields:
            if f.type != "reference":
                continue
            lid = f"{t.key}.{f.key}"
            used, total = usage.get(lid, (0, 0))
            if f.required and total > used:
                add(
                    "required_empty",
                    "warning",
                    lid,
                    f"{total - used} of {total} {t.plural_label} have no {f.label}. They will need one the next time someone edits them.",
                )
            if f.ref_table == t.key:
                add(
                    "self_link",
                    "note",
                    lid,
                    f"{t.label} links to other {t.plural_label} ('{f.label}'). That suits things like 'reports to'; keep it optional.",
                )
            pairs.setdefault((t.key, f.ref_table or ""), []).append(f.label)
    for (a, b), names in pairs.items():
        if len(names) > 1 and a != b:
            add(
                "parallel_links",
                "note",
                None,
                f"{labels[a]} has {len(names)} links to {labels.get(b, b)} ({', '.join(names)}). Fine if they mean different things.",
            )
    for t in tables:
        refs = [f for f in t.fields if f.type == "reference" and f.required]
        if (
            t.source != "agency"
            or len(refs) != 2
            or len([f for f in t.fields if f.type == "reference"]) != 2
        ):
            continue
        exists = (
            await s.execute(text("SELECT to_regclass(:n)"), {"n": f'"{schema}"."{t.key}"'})
        ).scalar_one()
        if exists is None:
            continue
        a, b = refs[0].key, refs[1].key
        dup = (
            await s.execute(
                text(
                    f'SELECT count(*) FROM (SELECT 1 FROM "{schema}"."{t.key}" WHERE data->>:a IS NOT NULL AND data->>:b IS NOT NULL '  # noqa: S608 - identifiers are validated metadata keys
                    "GROUP BY data->>:a, data->>:b HAVING count(*) > 1) x"
                ),
                {"a": a, "b": b},
            )
        ).scalar_one()
        if dup:
            add(
                "duplicate_pairs",
                "warning",
                f"{t.key}.{a}",
                f"{dup} pair{'s are' if dup != 1 else ' is'} stored twice in {t.label}. Remove the repeats so each pair appears once.",
            )
    return issues
