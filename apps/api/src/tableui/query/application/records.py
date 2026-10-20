"""Read side: lists with server-side sorting and cursor paging, single records, history."""

import base64
import json
import uuid
from typing import Any

from sqlalchemy import text

from tableui.audit.public import read_history
from tableui.identity.public import Principal
from tableui.metadata.public import RuntimeApp, TableDef
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed

MAX_PAGE = 200
_NUMERIC = {"integer", "decimal"}


def _sort_spec(table: TableDef, key: str) -> tuple[str, str]:
    """(SQL expression, SQL type of the cursor value). Only metadata-known keys reach SQL."""
    if key in ("updated_at", "created_at"):
        return f'"{key}"', "timestamptz"
    f = table.field(key)
    if f is None:
        raise ValidationFailed(
            errors=[{"field": "sort", "code": "unknown", "message": f"'{key}' is not a field"}]
        )
    if f.type in _NUMERIC:
        return f"COALESCE((data->>'{key}')::numeric, -1)", "numeric"
    return f"COALESCE(data->>'{key}', '')", "text"


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


def _row(table: TableDef, r: Any) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "table": table.key,
        "version": r.version,
        "data": r.data,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat(),
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
) -> dict[str, Any]:
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    if direction not in ("asc", "desc"):
        raise ValidationFailed(
            errors=[{"field": "direction", "code": "invalid", "message": "must be asc or desc"}]
        )
    limit = max(1, min(limit, MAX_PAGE))
    expr, sql_type = _sort_spec(table, sort)
    op = ">" if direction == "asc" else "<"
    where = ""
    params: dict[str, Any] = {"lim": limit + 1}
    if cursor:
        value, rid = _decode(cursor)
        where = f"WHERE ({expr}, id) {op} (CAST(:cv AS {sql_type}), CAST(:cid AS uuid))"
        params |= {"cv": value, "cid": rid}
    sql = (
        f'SELECT id, version, data, created_at, updated_at, {expr} AS sort_value FROM "{table_key}" '  # noqa: S608 - identifiers are validated metadata keys
        f"{where} ORDER BY {expr} {direction}, id {direction} LIMIT :lim"
    )
    async with db.tenant(principal.tenant_id) as s:
        rows = (await s.execute(text(sql), params)).all()
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page:
        last = page[-1]
        v = last.sort_value
        next_cursor = _encode(
            v.isoformat()
            if hasattr(v, "isoformat")
            else (float(v) if sql_type == "numeric" else v),
            str(last.id),
        )
    return {"items": [_row(table, r) for r in page], "next_cursor": next_cursor}


async def get_record(
    db: Database, principal: Principal, app: RuntimeApp, table_key: str, record_id: uuid.UUID
) -> dict[str, Any]:
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    async with db.tenant(principal.tenant_id) as s:
        r = (
            await s.execute(
                text(
                    f'SELECT id, version, data, created_at, updated_at FROM "{table_key}" WHERE id = :i'  # noqa: S608 - identifiers are validated metadata keys
                ),
                {"i": record_id},
            )
        ).first()
    if r is None:
        raise NotFound("That record does not exist.")
    return _row(table, r)


async def get_history(
    db: Database, principal: Principal, app: RuntimeApp, table_key: str, record_id: uuid.UUID
) -> list[dict[str, Any]]:
    principal.require(f"record.{table_key}.read")
    app.table(table_key)
    async with db.tenant(principal.tenant_id) as s:
        entries = await read_history(s, table_key, record_id)
        exists = (
            await s.execute(text(f'SELECT 1 FROM "{table_key}" WHERE id = :i'), {"i": record_id})  # noqa: S608 - identifiers are validated metadata keys
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
            "before": e.before,
            "after": e.after,
            "actor_id": e.actor_id,
            "actor_name": names.get(e.actor_id),
            "app_version": e.app_version,
            "at": e.at.isoformat(),
            "hash": e.hash,
            "prev_hash": e.prev_hash,
        }
        for e in entries
    ]
