"""The chart above a table: records grouped by one field, with one or two measures per group.

Computed by the database over every record the current search matches, with the same scope and
filters as the list. A field the person may not see, or that the owner left out of charts, is
never offered; a request for one is refused.
"""

import datetime as dt
from typing import Any

from sqlalchemy import text

from tableui.identity.public import Principal, scope_predicate
from tableui.metadata.public import CHART_NUMBER_TYPES, CHART_X_TYPES, RuntimeApp, features_of
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied, ValidationFailed
from tableui.query.application.records import _filter_conditions

MAX_GROUPS = 200  # groups read from the database before the top N are cut
MAX_BUCKETS = 60  # most recent periods shown for a date
_WORD = {"sum": "Total", "avg": "Average", "min": "Lowest", "max": "Highest"}


def _bad(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": "invalid", "message": message}])


def _num(v: Any) -> float | int | None:
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else round(f, 2)


def parse_measures(raw: str | None) -> list[tuple[str, str | None]]:
    """`count`, `sum:notice_days`, `avg:expected_ctc` separated by commas; at most two."""
    out: list[tuple[str, str | None]] = []
    for part in (raw or "count").split(","):
        agg, _, field = part.strip().partition(":")
        if agg not in ("count", "sum", "avg", "min", "max") or (agg != "count" and not field):
            raise _bad("measures", f"'{part}' is not a measure")
        out.append((agg, field or None))
    if not 1 <= len(out) <= 2:
        raise _bad("measures", "choose one or two measures")
    return out


async def table_chart(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    x: str | None = None,
    bucket: str = "month",
    measures: str | None = None,
    top: int = 8,
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
    if not feat.statistics or feat.stat_view != "chart":
        raise PermissionDenied("A chart is not switched on for this table.")
    denied = {f for (t, f) in principal.field_denies if t == table.key}
    offered = {f.key: f for f in table.fields if not f.hidden and f.key not in denied and f.key not in feat.nochart}  # fmt: skip
    groupable = [f for f in offered.values() if f.type in CHART_X_TYPES]
    if x is None:
        if not groupable:
            raise _bad("x", "no field can be grouped on this table")
        xf = groupable[0]
    else:
        xf = offered.get(x)  # type: ignore[assignment]
        if xf is None or xf.type not in CHART_X_TYPES:
            raise _bad("x", f"'{x}' cannot be grouped")
    if bucket not in ("day", "week", "month"):
        raise _bad("bucket", "choose day, week or month")
    if not 1 <= top <= 20:
        raise _bad("top", "choose between 1 and 20")
    ms = parse_measures(measures)
    series: list[dict[str, Any]] = []
    for agg, field in ms:
        if agg == "count":
            series.append({"key": "count", "agg": agg, "field": None, "label": table.plural_label, "type": "integer"})  # fmt: skip
            continue
        nf = offered.get(field or "")
        if nf is None or nf.type not in CHART_NUMBER_TYPES:
            raise _bad("measures", f"'{field}' is not a number field you can chart")
        series.append({"key": f"{agg}:{nf.key}", "agg": agg, "field": nf.key, "label": f"{_WORD[agg]} {nf.label.lower()}", "type": nf.type})  # fmt: skip
    whole = feat.stat_scope == "table"
    conds, params = (
        ([], {})
        if whole
        else _filter_conditions(
            principal, table, filters or {}, q, ranges, owner, has, contains, anyof
        )  # fmt: skip
    )
    scope_sql, scope_params = await scope_predicate(db, principal, table_key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    is_date = xf.type == "date"
    if is_date:
        group = (
            f"date_trunc('{bucket}', (data->>'{xf.key}')::date)::date"  # bucket is validated above
        )
        conds.append(f"data->>'{xf.key}' IS NOT NULL AND data->>'{xf.key}' <> ''")
    else:
        group = f"COALESCE(NULLIF(data->>'{xf.key}', ''), '')"
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    cols = ["count(*) AS n"]
    for i, m in enumerate(series):
        if m["agg"] == "count":
            continue
        e = f"(data->>'{m['field']}')::numeric"
        cols += [f"count({e}) AS c{i}", f"sum({e}) AS s{i}", f"min({e}) AS lo{i}", f"max({e}) AS hi{i}"]  # fmt: skip
    order = f"{group} DESC" if is_date else "n DESC, 1"
    limit = MAX_BUCKETS if is_date else MAX_GROUPS
    sql = f'SELECT {group} AS g, {", ".join(cols)} FROM "{table_key}" {where} GROUP BY 1 ORDER BY {order} LIMIT {limit}'  # noqa: S608 - identifiers are validated metadata keys
    async with db.tenant(principal.tenant_id) as s:
        rows = [r._mapping for r in (await s.execute(text(sql), params)).all()]
    if is_date:
        rows = sorted(rows, key=lambda r: r["g"])  # oldest first, left to right

    def value(rs: list[Any], i: int, m: dict[str, Any]) -> Any:
        if m["agg"] == "count":
            return sum(r["n"] for r in rs)
        if m["agg"] == "sum":
            parts = [r[f"s{i}"] for r in rs if r[f"s{i}"] is not None]
            return _num(sum(parts)) if parts else None
        if m["agg"] == "avg":
            n = sum(r[f"c{i}"] for r in rs)
            parts = [r[f"s{i}"] for r in rs if r[f"s{i}"] is not None]
            return _num(sum(parts) / n) if n and parts else None
        picks = [r[f"lo{i}" if m["agg"] == "min" else f"hi{i}"] for r in rs]
        picks = [p for p in picks if p is not None]
        return _num(min(picks) if m["agg"] == "min" else max(picks)) if picks else None

    def label(r: Any) -> str:
        g = r["g"]
        if isinstance(g, dt.date):
            return g.isoformat()
        return str(g) if g not in (None, "") else "Not set"

    shown, rest = (rows, []) if is_date else (rows[:top], rows[top:])
    points = [
        {
            "key": label(r),
            "label": label(r),
            "count": r["n"],
            "values": {m["key"]: value([r], i, m) for i, m in enumerate(series)},
        }  # fmt: skip
        for r in shown
    ]
    if rest:
        points.append(
            {
                "key": "_others",
                "label": "Others",
                "count": sum(r["n"] for r in rest),
                "values": {m["key"]: value(rest, i, m) for i, m in enumerate(series)},
            }  # fmt: skip
        )
    return {
        "x": {
            "key": xf.key,
            "label": xf.label,
            "type": xf.type,
            "bucket": bucket if is_date else None,
        },
        "measures": series,
        "points": points,
        "total": sum(r["n"] for r in rows),
        "overall": {m["key"]: value(rows, i, m) for i, m in enumerate(series)},
        "scope": "table" if whole else "search",
        "groupable": [{"key": f.key, "label": f.label, "type": f.type} for f in groupable],
        "numbers": [
            {"key": f.key, "label": f.label, "type": f.type}
            for f in offered.values()
            if f.type in CHART_NUMBER_TYPES
        ],  # fmt: skip
    }
