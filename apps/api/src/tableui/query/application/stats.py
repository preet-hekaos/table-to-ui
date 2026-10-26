"""Numbers above the table: how many records match, and totals and averages of number fields.

Computed by the database over every matching record (not only the rows loaded on screen), with the
same scope and filters as the list. A field the person may not see is never summarised.
"""

from typing import Any

from sqlalchemy import text

from tableui.identity.public import Principal, scope_predicate
from tableui.metadata.public import RuntimeApp, features_of
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied, ValidationFailed
from tableui.query.application.records import _filter_conditions

NUMBER_TYPES = ("integer", "decimal", "money", "months")
AUTO_FIELDS = 3


def _num(v: Any) -> float | int | None:
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else round(f, 2)


async def table_stats(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    fields: list[str] | None = None,
    filters: dict[str, str] | None = None,
    q: str | None = None,
    ranges: dict[str, str] | None = None,
    owner: str | None = None,
    has: dict[str, str] | None = None,
    contains: dict[str, str] | None = None,
    anyof: dict[str, str] | None = None,
) -> dict[str, Any]:
    principal.require(f"record.{table_key}.read")
    table = app.table(table_key)
    feat = features_of(table)
    if not feat.statistics:
        raise PermissionDenied("Numbers above the table are switched off for this table.")
    denied = {f for (t, f) in principal.field_denies if t == table.key}
    usable = [
        f for f in table.fields if f.type in NUMBER_TYPES and not f.hidden and f.key not in denied
    ]
    by_key = {f.key: f for f in usable}
    if fields:
        missing = [k for k in fields if k not in by_key]
        if missing:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "fields",
                        "code": "invalid",
                        "message": f"'{missing[0]}' is not a number field you can see",
                    }
                ]
            )
        chosen = [by_key[k] for k in fields]
    elif feat.stat_fields is not None:
        chosen = [by_key[k] for k in feat.stat_fields if k in by_key]
    else:
        chosen = usable[:AUTO_FIELDS]
    conds, params = _filter_conditions(
        principal, table, filters or {}, q, ranges, owner, has, contains, anyof
    )
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    parts = ["count(*) AS total"]
    for i, f in enumerate(chosen):
        e = f"(data->>'{f.key}')::numeric"
        parts += [f"count({e}) AS c{i}", f"sum({e}) AS s{i}", f"avg({e}) AS a{i}", f"min({e}) AS lo{i}", f"max({e}) AS hi{i}"]  # fmt: skip
    sql = f'SELECT {", ".join(parts)} FROM "{table_key}" {where}'  # noqa: S608 - identifiers are validated metadata keys
    async with db.tenant(principal.tenant_id) as s:
        row = (await s.execute(text(sql), params)).one()._mapping
    return {
        "total": row["total"],
        "fields": [
            {
                "key": f.key,
                "label": f.label,
                "type": f.type,
                "count": row[f"c{i}"],
                "sum": _num(row[f"s{i}"]),
                "avg": _num(row[f"a{i}"]),
                "min": _num(row[f"lo{i}"]),
                "max": _num(row[f"hi{i}"]),
            }  # fmt: skip
            for i, f in enumerate(chosen)
        ],
    }
