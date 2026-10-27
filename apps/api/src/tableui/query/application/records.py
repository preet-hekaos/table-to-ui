"""Read side: lists with server-side sorting and cursor paging, single records, history."""

import base64
import datetime as dt
import json
import uuid
from typing import Any

from sqlalchemy import text

from tableui.audit.public import read_history
from tableui.identity.public import Principal, scope_predicate, strip_hidden
from tableui.metadata.public import RuntimeApp, TableDef, features_of
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed

MAX_PAGE = 200
_NUMERIC = {"integer", "decimal"}


def _sort_spec(table: TableDef, key: str, hidden: set[str] | None = None) -> tuple[str, str]:
    """(SQL expression, SQL type of the cursor value). Only metadata-known keys reach SQL.
    A field the person may not see cannot be sorted on: the order would reveal its values."""
    if key in ("updated_at", "created_at"):
        return f'"{key}"', "timestamptz"
    if (
        key == "manual"
    ):  # the shared order: dragged records by position; newer, never-placed ones on top
        return 'COALESCE("sort_order", -1e12 - extract(epoch FROM "updated_at"))', "numeric"
    f = table.field(key)
    if f is None or key in (hidden or set()):
        raise ValidationFailed(
            errors=[{"field": "sort", "code": "unknown", "message": f"'{key}' is not a field"}]
        )
    if f.type in _NUMERIC:
        return f"COALESCE((data->>'{key}')::numeric, -1)", "numeric"
    return f"COALESCE(data->>'{key}', '')", "text"


_RANGED = {"integer", "decimal", "money", "months"}
_TEXTY = {"text", "long_text", "email", "phone", "url"}
_CHOICES = {"select", "reference", "tags"}
_TEXTLIKE = {"text", "email", "phone", "url"}
# Fields that can be filtered by ticking values from a list of what the column holds (Excel style).
_LISTABLE = _CHOICES | _TEXTLIKE | {"boolean"}
VALUE_LIST_MAX = 200


def _bad(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": "invalid", "message": message}])


def _filter_conditions(
    principal: Principal,
    table: TableDef,
    filters: dict[str, str],
    q: str | None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
) -> tuple[list[str], dict[str, Any]]:
    """Filters on fields, ranges, owner, counts and a keyword search. Only known keys reach SQL."""
    conds: list[str] = []
    params: dict[str, Any] = {}
    hidden = {f for (t, f) in principal.field_denies if t == table.key}
    for i, (key, value) in enumerate(filters.items()):
        f = table.field(key)
        if f is None or key in hidden:
            raise ValidationFailed(
                errors=[{"field": key, "code": "unknown", "message": "cannot be filtered on"}]
            )
        if f.type == "tags":
            conds.append(f"data->'{key}' @> CAST(:flt{i} AS jsonb)")
            params[f"flt{i}"] = json.dumps([value])
        elif f.type in ("text", "long_text", "email"):
            conds.append(f"lower(data->>'{key}') = lower(:flt{i})")
            params[f"flt{i}"] = value
        else:
            conds.append(f"data->>'{key}' = :flt{i}")
            params[f"flt{i}"] = value
    feat = features_of(table)
    sort_filter = feat.sort_filter and feat.filterable
    for i, (key, value) in enumerate((contains or {}).items()):
        f = table.field(key)
        if f is None or key in hidden or f.type not in _TEXTY or not sort_filter:
            raise _bad(f"c.{key}", "cannot be searched this way")
        conds.append(f"position(lower(:ct{i}) in lower(COALESCE(data->>'{key}', ''))) > 0")
        params[f"ct{i}"] = value.strip()
    for i, (key, value) in enumerate((anyof or {}).items()):
        f = table.field(key)
        if f is None or key in hidden or f.type not in _LISTABLE or not sort_filter:
            raise _bad(f"in.{key}", "cannot be filtered by a list of choices")
        picks = [x for x in value.split(",") if x][:VALUE_LIST_MAX]
        if f.type == "tags":
            conds.append(f"jsonb_exists_any(data->'{key}', CAST(:an{i} AS text[]))")
        elif f.type in _TEXTLIKE:
            conds.append(f"lower(data->>'{key}') = ANY(CAST(:an{i} AS text[]))")
            picks = [x.lower() for x in picks]
        else:
            conds.append(f"data->>'{key}' = ANY(CAST(:an{i} AS text[]))")
        params[f"an{i}"] = picks
    for i, (key, value) in enumerate((ranges or {}).items()):
        f = table.field(key)
        if f is None or key in hidden or f.type not in _RANGED | {"date"}:
            raise _bad(f"r.{key}", "cannot be used as a range")
        lo, _, hi = value.partition("..")
        if f.type == "date":
            if not sort_filter:
                raise _bad(f"r.{key}", "cannot be used as a range")
            try:
                lo_d = dt.date.fromisoformat(lo) if lo else None
                hi_d = dt.date.fromisoformat(hi) if hi else None
            except ValueError:
                raise _bad(f"r.{key}", "must look like 2026-01-01..2026-03-31") from None
            if lo_d:
                conds.append(f"data->>'{key}' >= :dlo{i}")
                params[f"dlo{i}"] = lo_d.isoformat()
            if hi_d:
                conds.append(f"data->>'{key}' <= :dhi{i}")
                params[f"dhi{i}"] = hi_d.isoformat()
            continue
        try:
            lo_v = float(lo) if lo else None
            hi_v = float(hi) if hi else None
        except ValueError:
            raise _bad(f"r.{key}", "must look like 10..20") from None
        if lo_v is not None:
            conds.append(f"(data->>'{key}')::numeric >= :rlo{i}")
            params[f"rlo{i}"] = lo_v
        if hi_v is not None:
            conds.append(f"(data->>'{key}')::numeric < :rhi{i}")
            params[f"rhi{i}"] = hi_v
    if owner:
        try:
            params["owner"] = principal.user_id if owner == "me" else uuid.UUID(owner)
        except ValueError:
            raise _bad("owner", "must be a person's id or 'me'") from None
        conds.append("owner_id = :owner")
    for i, (key, value) in enumerate((has or {}).items()):
        c = next((x for x in table.counts if x.key == key), None)
        if c is None or value not in ("yes", "no"):
            raise _bad(f"has.{key}", "is not a count of this table")
        sub, sub_params = _count_subquery(table.key, c, f"h{i}")
        conds.append(f"{'' if value == 'yes' else 'NOT '}EXISTS ({sub})")
        params |= sub_params
    if q and q.strip():
        match = (
            "(search_doc ILIKE '%' || :q || '%' OR public.word_similarity(:q, search_doc) > 0.45)"
        )
        extra = [
            f"id IN (SELECT (data->>'{inc.via}')::uuid FROM \"{inc.table}\" WHERE {match})"  # noqa: S608 - identifiers are validated metadata keys
            for inc in table.search_includes
        ]
        conds.append("(" + " OR ".join([match, *extra]) + ")")
        params["q"] = q.strip().lower()
    return conds, params


def _count_subquery(table_key: str, c: Any, p: str) -> tuple[str, dict[str, Any]]:
    """Rows of the counted table that point at the outer row ``"<table_key>".id``."""
    where = [f"(c.data->>'{c.via}')::uuid = \"{table_key}\".id"]
    params: dict[str, Any] = {}
    for j, (k, v) in enumerate(c.where.items()):
        where.append(f"c.data->>'{k}' = :{p}w{j}")
        params[f"{p}w{j}"] = str(v).lower() if isinstance(v, bool) else str(v)
    return f'SELECT 1 FROM "{c.table}" c WHERE ' + " AND ".join(where), params  # noqa: S608 - identifiers are validated metadata keys


async def _attach_counts(s: Any, table: TableDef, items: list[dict[str, Any]]) -> None:
    if not table.counts or not items:
        return
    ids = [i["id"] for i in items]
    for c in table.counts:
        params: dict[str, Any] = {"ids": ids}
        where = [f"c.data->>'{c.via}' = ANY(:ids)"]
        for j, (k, v) in enumerate(c.where.items()):
            where.append(f"c.data->>'{k}' = :w{j}")
            params[f"w{j}"] = str(v).lower() if isinstance(v, bool) else str(v)
        rows = await s.execute(
            text(
                f"SELECT c.data->>'{c.via}' AS ref, count(*) AS n FROM \"{c.table}\" c "  # noqa: S608 - identifiers are validated metadata keys
                f"WHERE {' AND '.join(where)} GROUP BY 1"
            ),
            params,
        )
        found = {r.ref: r.n for r in rows}
        for i in items:
            i.setdefault("counts", {})[c.key] = found.get(i["id"], 0)


async def _attach_owners(
    db: Database, items: list[dict[str, Any]], owner_ids: dict[str, Any]
) -> None:
    ids = {v for v in owner_ids.values() if v}
    if not ids:
        return
    async with db.control() as c:
        rows = await c.execute(
            text("SELECT id, full_name FROM control.app_user WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": list(ids)},
        )
        names = {r.id: r.full_name for r in rows}
    for i in items:
        oid = owner_ids.get(i["id"])
        i["owner"] = {"id": str(oid), "name": names.get(oid)} if oid else None


def _encode(value: Any, rid: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([value, rid]).encode()).decode()


def _decode(cursor: str) -> tuple[Any, str]:
    try:
        value, rid = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        uuid.UUID(rid)
    except Exception:
        raise ValidationFailed(
            errors=[{"field": "cursor", "code": "invalid", "message": "is not a valid cursor"}]
        ) from None
    return value, rid


def _row(table: TableDef, r: Any, p: Principal | None = None) -> dict[str, Any]:
    data = strip_hidden(p, table.key, r.data) if p else r.data
    return {
        "id": str(r.id),
        "table": table.key,
        "version": r.version,
        "data": data,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat(),
    }


async def _attach_refs(
    s: Any, app: RuntimeApp, table: TableDef, items: list[dict[str, Any]]
) -> None:
    """Add ``refs``: the title of every record a reference field points at, for display."""
    for f in table.fields:
        if f.type != "reference" or not f.ref_table or f.ref_table not in app.tables:
            continue
        ids = {i["data"].get(f.key) for i in items if i["data"].get(f.key)}
        if not ids:
            continue
        target = app.tables[f.ref_table]
        rows = (
            await s.execute(
                text(
                    f'SELECT id, data FROM "{target.key}" WHERE id = ANY(CAST(:ids AS uuid[]))'  # noqa: S608 - identifiers are validated metadata keys
                ),
                {"ids": list(ids)},
            )
        ).all()
        labels = {str(r.id): (r.data or {}).get(target.title_field) for r in rows}
        for i in items:
            v = i["data"].get(f.key)
            if v:
                i.setdefault("refs", {})[f.key] = {
                    "table": target.key,
                    "id": v,
                    "label": labels.get(v),
                }


async def list_records(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    sort: str = "updated_at",
    direction: str = "desc",
    cursor: str | None = None,
    limit: int = 50,
    filters: dict[str, str] | None = None,
    q: str | None = None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
    ids: list[uuid.UUID] | None = None,
    page: int | None = None,
    page_size: int = 25,
) -> dict[str, Any]:
    """One page of records. With ``page`` set the answer is a numbered page and carries ``total``;
    otherwise it pages by cursor as before."""
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    if direction not in ("asc", "desc"):
        raise ValidationFailed(
            errors=[{"field": "direction", "code": "invalid", "message": "must be asc or desc"}]
        )
    limit = max(1, min(limit, MAX_PAGE))
    hidden = {f for (t, f) in principal.field_denies if t == table.key}
    expr, sql_type = _sort_spec(table, sort, hidden)
    op = ">" if direction == "asc" else "<"
    conds: list[str] = []
    params: dict[str, Any] = {"lim": limit + 1}
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    conds_f, params_f = _filter_conditions(
        principal, table, filters or {}, q, ranges, owner, has, contains, anyof
    )
    conds += conds_f
    params |= params_f
    if ids is not None:
        conds.append("id = ANY(CAST(:only_ids AS uuid[]))")
        params["only_ids"] = ids
    numbered = page is not None
    total: int | None = None
    number = 0
    if page is not None:
        size = max(1, min(page_size, MAX_PAGE))
        where_all = f"WHERE {' AND '.join(conds)}" if conds else ""
        count_sql = f'SELECT count(*) FROM "{table_key}" {where_all}'  # noqa: S608 - identifiers are validated metadata keys
        async with db.tenant(principal.tenant_id) as s:
            total = int((await s.execute(text(count_sql), params)).scalar_one())
        last_page = max(1, -(-total // size))
        number = max(1, min(page, last_page))
        limit = size
        params["lim"] = size
        params["off"] = (number - 1) * size
    elif cursor:
        value, rid = _decode(cursor)
        conds.append(f"({expr}, id) {op} (CAST(:cv AS {sql_type}), CAST(:cid AS uuid))")
        params |= {"cv": value, "cid": rid}
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    offset = " OFFSET :off" if numbered else ""
    sql = (
        f'SELECT id, version, data, owner_id, created_at, updated_at, {expr} AS sort_value FROM "{table_key}" '  # noqa: S608 - identifiers are validated metadata keys
        f"{where} ORDER BY {expr} {direction}, id {direction} LIMIT :lim{offset}"
    )
    async with db.tenant(principal.tenant_id) as s:
        rows = (await s.execute(text(sql), params)).all()
    page_rows = rows[:limit]
    items = [_row(table, r, principal) for r in page_rows]
    async with db.tenant(principal.tenant_id) as s:
        await _attach_refs(s, app, table, items)
        await _attach_counts(s, table, items)
    await _attach_owners(db, items, {str(r.id): r.owner_id for r in page_rows})
    if numbered:
        return {
            "items": items,
            "next_cursor": None,
            "total": total,
            "page": number,
            "page_size": limit,
        }
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        v = last.sort_value
        next_cursor = _encode(
            v.isoformat()
            if hasattr(v, "isoformat")
            else (float(v) if sql_type == "numeric" else v),
            str(last.id),
        )
    return {"items": items, "next_cursor": next_cursor}


async def matching_ids(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    ids: list[uuid.UUID] | None = None,
    filters: dict[str, str] | None = None,
    q: str | None = None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
    limit: int = 10_000,
) -> tuple[list[uuid.UUID], bool]:
    """The ids this person may see that match, up to ``limit``; the flag says more exist.

    Uses the same scope and filter rules as the list, so a bulk action can never reach
    a record the person could not have ticked.
    """
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    conds: list[str] = []
    params: dict[str, Any] = {"lim": limit + 1}
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    conds_f, params_f = _filter_conditions(
        principal, table, filters or {}, q, ranges, owner, has, contains, anyof
    )
    conds += conds_f
    params |= params_f
    if ids is not None:
        conds.append("id = ANY(CAST(:only_ids AS uuid[]))")
        params["only_ids"] = ids
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    sql = f'SELECT id FROM "{table_key}" {where} ORDER BY id LIMIT :lim'  # noqa: S608 - identifiers are validated metadata keys
    async with db.tenant(principal.tenant_id) as s:
        rows = (await s.execute(text(sql), params)).all()
    return [r.id for r in rows[:limit]], len(rows) > limit


async def get_record(
    db: Database, principal: Principal, app: RuntimeApp, table_key: str, record_id: uuid.UUID
) -> dict[str, Any]:
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    async with db.tenant(principal.tenant_id) as s:
        r = (
            await s.execute(
                text(
                    f'SELECT id, version, data, owner_id, created_at, updated_at FROM "{table_key}" '  # noqa: S608 - identifiers are validated metadata keys
                    f"WHERE id = :i{' AND ' + scope_sql if scope_sql else ''}"
                ),
                {"i": record_id, **scope_params},
            )
        ).first()
        if r is None:
            raise NotFound("That record does not exist.")
        out = _row(table, r, principal)
        await _attach_refs(s, app, table, [out])
        await _attach_counts(s, table, [out])
    await _attach_owners(db, [out], {out["id"]: r.owner_id})
    return out


async def get_history(
    db: Database, principal: Principal, app: RuntimeApp, table_key: str, record_id: uuid.UUID
) -> list[dict[str, Any]]:
    principal.require(f"record.{table_key}.read")
    app.table(table_key)
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    async with db.tenant(principal.tenant_id) as s:
        entries = await read_history(s, table_key, record_id)
        exists = (
            await s.execute(
                text(
                    f'SELECT 1 FROM "{table_key}" WHERE id = :i'  # noqa: S608 - identifiers are validated metadata keys
                    f"{' AND ' + scope_sql if scope_sql else ''}"
                ),
                {"i": record_id, **scope_params},
            )
        ).first()
    if not exists:
        raise NotFound("That record does not exist.")
    ids = {e.actor_id for e in entries}
    names: dict[str, str] = {}
    if ids:
        async with db.control() as c:
            rows = (
                await c.execute(
                    text(
                        "SELECT id, full_name FROM control.app_user WHERE id = ANY(CAST(:ids AS uuid[]))"
                    ),
                    {"ids": list(ids)},
                )
            ).all()
            names = {str(r.id): r.full_name for r in rows}
    return [
        {
            "seq": e.seq,
            "action": e.action,
            "before": strip_hidden(principal, table_key, e.before),
            "after": strip_hidden(principal, table_key, e.after),
            "actor_id": e.actor_id,
            "actor_name": names.get(e.actor_id),
            "app_version": e.app_version,
            "at": e.at.isoformat(),
            "hash": e.hash,
            "prev_hash": e.prev_hash,
        }
        for e in entries
    ]


_BUCKETS: dict[str, list[tuple[float, float | None, str]]] = {
    "months": [
        (0, 24, "Under 2 yrs"),
        (24, 60, "2 to 5 yrs"),
        (60, 120, "5 to 10 yrs"),
        (120, None, "10 yrs or more"),
    ],
    "money": [
        (0, 500_000, "Under 5 LPA"),
        (500_000, 1_000_000, "5 to 10 LPA"),
        (1_000_000, 2_000_000, "10 to 20 LPA"),
        (2_000_000, 4_000_000, "20 to 40 LPA"),
        (4_000_000, None, "40 LPA or more"),
    ],
    "integer": [
        (0, 16, "Up to 15"),
        (16, 31, "16 to 30"),
        (31, 61, "31 to 60"),
        (61, 91, "61 to 90"),
        (91, None, "More than 90"),
    ],
}


async def facet_counts(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    fields: list[str] | None,
    filters: dict[str, str] | None = None,
    q: str | None = None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Counts for each facet under the current search: values for choices and labels, buckets for numbers."""
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    hidden = {f for (t, f) in principal.field_denies if t == table.key}
    wanted = fields or [f.key for f in table.fields if f.filterable]
    conds, params = _filter_conditions(
        principal, table, filters or {}, q, ranges, owner, has, contains, anyof
    )
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    out: dict[str, Any] = {}
    async with db.tenant(principal.tenant_id) as s:
        total = (
            await s.execute(text(f'SELECT count(*) FROM "{table_key}" {where}'), params)
        ).scalar_one()  # noqa: S608 - identifiers are validated metadata keys
        for key in wanted:
            f = table.field(key)
            if f is None or key in hidden or f.hidden:
                continue
            if f.type in _BUCKETS:
                b = _BUCKETS[f.type]
                parts = [
                    f"count(*) FILTER (WHERE (data->>'{key}')::numeric >= {lo}"
                    + (f" AND (data->>'{key}')::numeric < {hi})" if hi is not None else ")")
                    for lo, hi, _ in b
                ]
                row = (
                    await s.execute(
                        text(f'SELECT {", ".join(parts)} FROM "{table_key}" {where}'), params
                    )
                ).one()  # noqa: S608 - identifiers are validated metadata keys
                out[key] = {
                    "label": f.label,
                    "kind": "range",
                    "values": [
                        {
                            "value": f"{lo:g}..{'' if hi is None else f'{hi:g}'}",
                            "label": label,
                            "count": row[i],
                        }
                        for i, (lo, hi, label) in enumerate(b)
                    ],
                }
                continue
            if f.type == "tags":
                sql = (
                    f"SELECT v, count(*) AS n FROM \"{table_key}\", jsonb_array_elements_text(COALESCE(data->'{key}', '[]'::jsonb)) AS v "  # noqa: S608 - identifiers are validated metadata keys
                    f"{where} GROUP BY v ORDER BY n DESC, v LIMIT 25"
                )
            elif f.type in ("select", "boolean", "reference", "text", "email"):
                sql = (
                    f"SELECT data->>'{key}' AS v, count(*) AS n FROM \"{table_key}\" "  # noqa: S608 - identifiers are validated metadata keys
                    f"{where}{' AND ' if where else 'WHERE '}data->>'{key}' IS NOT NULL AND data->>'{key}' <> '' "
                    "GROUP BY 1 ORDER BY n DESC, v LIMIT 25"
                )
            else:
                continue
            rows = (await s.execute(text(sql), params)).all()
            values = [{"value": r.v, "label": r.v, "count": r.n} for r in rows]
            if f.type == "reference" and f.ref_table in app.tables and values:
                target = app.tables[f.ref_table]
                labels = {
                    str(r.id): (r.data or {}).get(target.title_field)
                    for r in await s.execute(
                        text(
                            f'SELECT id, data FROM "{target.key}" WHERE id = ANY(CAST(:ids AS uuid[]))'
                        ),  # noqa: S608 - identifiers are validated metadata keys
                        {"ids": [v["value"] for v in values]},
                    )
                }
                for v in values:
                    v["label"] = labels.get(v["value"]) or v["value"]
            out[key] = {"label": f.label, "kind": "values", "values": values}
    return {"total": total, "facets": out}


async def field_values(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    field_key: str,
    *,
    search: str | None = None,
    limit: int = VALUE_LIST_MAX,
    filters: dict[str, str] | None = None,
    q: str | None = None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
) -> dict[str, Any]:
    """What one column holds, with counts, for the Excel-style filter. The caller leaves this
    column's own filter out of the query so every value stays listed; the rest of the search applies."""
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    f = table.field(field_key)
    hidden = {x for (t, x) in principal.field_denies if t == table.key}
    if f is None or field_key in hidden or f.hidden or f.type not in _LISTABLE:
        raise _bad(field_key, "has no list of values")
    limit = max(1, min(limit, VALUE_LIST_MAX))
    conds, params = _filter_conditions(
        principal, table, filters or {}, q, ranges, owner, has, contains, anyof
    )
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    key = field_key
    if f.type == "tags":
        source = (
            f"\"{table_key}\", jsonb_array_elements_text(COALESCE(data->'{key}', '[]'::jsonb)) AS v"
        )
        value = "v"
    else:
        source = f'"{table_key}"'
        value = f"data->>'{key}'"
    where = list(conds)
    if f.type != "reference" and search and search.strip():
        where.append(f"position(lower(:vs) in lower({value})) > 0")
        params["vs"] = search.strip()
    where.append(f"{value} IS NOT NULL AND {value} <> ''")
    sql = (
        f"SELECT {value} AS v, count(*) AS n FROM {source} WHERE {' AND '.join(where)} "  # noqa: S608 - identifiers are validated metadata keys
        f"GROUP BY 1 ORDER BY lower({value}), 1 LIMIT {limit + 1}"
    )
    async with db.tenant(principal.tenant_id) as s:
        rows = (await s.execute(text(sql), params)).all()
        truncated = len(rows) > limit
        rows = rows[:limit]
        values = [{"value": r.v, "label": r.v, "count": r.n} for r in rows]
        if f.type == "reference" and f.ref_table in app.tables and values:
            target = app.tables[f.ref_table]
            labels = {
                str(r.id): (r.data or {}).get(target.title_field)
                for r in await s.execute(
                    text(
                        f'SELECT id, data FROM "{target.key}" WHERE id = ANY(CAST(:ids AS uuid[]))'
                    ),  # noqa: S608 - identifiers are validated metadata keys
                    {"ids": [v["value"] for v in values]},
                )
            }
            for v in values:
                v["label"] = labels.get(v["value"]) or v["value"]
            if search and search.strip():
                needle = search.strip().lower()
                values = [v for v in values if needle in str(v["label"]).lower()]
        if f.type == "boolean":
            for v in values:
                v["label"] = "Yes" if v["value"] == "true" else "No"
    return {
        "field": field_key,
        "label": f.label,
        "kind": f.type,
        "values": values,
        "truncated": truncated,
    }


async def quick_search(
    db: Database, principal: Principal, app: RuntimeApp, q: str, per_table: int = 5
) -> list[dict[str, Any]]:
    """The command bar: records of every table the person may read whose name matches, best first."""
    q = q.strip().lower()
    if len(q) < 2:
        return []
    out: list[dict[str, Any]] = []
    async with db.tenant(principal.tenant_id) as s:
        for t in app.tables.values():
            if not principal.allows(f"record.{t.key}.read"):
                continue
            scope_sql, scope_params = await scope_predicate(db, principal, t.key)
            title = f"lower(COALESCE(data->>'{t.title_field}', ''))"
            rows = await s.execute(
                text(
                    f"SELECT id, data->>'{t.title_field}' AS label, "  # noqa: S608 - identifiers are validated metadata keys
                    f"GREATEST(public.similarity({title}, :q), CASE WHEN {title} LIKE :pre THEN 1 WHEN {title} LIKE :any THEN 0.8 ELSE 0 END) AS score "
                    f'FROM "{t.key}" WHERE ({title} LIKE :any OR {title} OPERATOR(public.%) :q)'
                    f"{' AND ' + scope_sql if scope_sql else ''} ORDER BY score DESC, label LIMIT :lim"
                ),
                {"q": q, "pre": q + "%", "any": "%" + q + "%", "lim": per_table, **scope_params},
            )
            out += [
                {
                    "kind": "record",
                    "table": t.key,
                    "table_label": t.label,
                    "id": str(r.id),
                    "label": r.label,
                    "score": float(r.score),
                }
                for r in rows
            ]
    out.sort(key=lambda x: (-x["score"], x["label"] or ""))
    return out[:20]
